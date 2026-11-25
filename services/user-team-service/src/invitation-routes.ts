import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

import { getDatabase } from './database';
import { sendError } from './http-error';
import { pageResult, readPage } from './pagination';
import { activeMembership, authenticatedSubject, lockActiveTeam, readTeamId } from './team-access';

const inviteUserInput = z.union([
  z.strictObject({ username: z.string().trim().min(1).max(254) }),
  z.strictObject({ email: z.string().trim().max(254).email().toLowerCase() }),
]);
const responseInput = z.strictObject({ status: z.enum(['ACCEPTED', 'DECLINED']) });
const invitationFields = {
  id: true, teamId: true, inviterId: true, inviteeId: true,
  status: true, createdAt: true, respondedAt: true,
} as const;

const invitationErrors = {
  'team-not-found': [404, 'TEAM_NOT_FOUND', 'Team was not found.'],
  forbidden: [403, 'INVITER_ROLE_REQUIRED', 'Only an active Owner or Leader can invite users.'],
  'invitee-not-found': [404, 'INVITEE_NOT_FOUND', 'No registered user matched the invitation.'],
  'already-member': [409, 'ALREADY_TEAM_MEMBER', 'The user is already an active team member.'],
  'duplicate-invitation': [409, 'INVITATION_ALREADY_PENDING', 'The user already has a pending invitation.'],
  'invitation-not-found': [404, 'INVITATION_NOT_FOUND', 'Invitation was not found.'],
  'invitation-not-pending': [409, 'INVITATION_NOT_PENDING', 'Only pending invitations can be changed.'],
} as const;

export const invitationRoutes = Router();

invitationRoutes.post('/teams/:teamId/invitations', async (request, response) => {
  const inviterId = authenticatedSubject(request, response);
  if (!inviterId) return;
  const teamId = readTeamId(request.params.teamId, response);
  if (!teamId) return;

  const input = inviteUserInput.safeParse(request.body);
  if (!input.success) {
    sendError(response, 400, 'INVALID_INPUT', 'Provide exactly one username or valid email address.');
    return;
  }

  const result = await getDatabase().$transaction(async tx => {
    if (!await lockActiveTeam(tx, teamId)) return { status: 'team-not-found' } as const;
    const inviter = await activeMembership(tx, teamId, inviterId);
    if (inviter?.role !== 'OWNER' && inviter?.role !== 'LEADER') return { status: 'forbidden' } as const;

    const invitee = await tx.user.findUnique({ where: input.data, select: { id: true } });
    if (!invitee) return { status: 'invitee-not-found' } as const;
    if (await activeMembership(tx, teamId, invitee.id)) return { status: 'already-member' } as const;

    const pending = await tx.invitation.findFirst({
      where: { teamId, inviteeId: invitee.id, status: 'PENDING' },
      select: { id: true },
    });
    if (pending) return { status: 'duplicate-invitation' } as const;

    const invitation = await tx.invitation.create({
      data: { teamId, inviterId, inviteeId: invitee.id, status: 'PENDING' },
      select: invitationFields,
    });
    await tx.outboxEvent.create({
      data: {
        teamId,
        correlationId: randomUUID(),
        eventType: 'INVITATION_CREATED',
        status: 'PENDING',
        data: {
          invitationId: invitation.id,
          teamId,
          recipientId: invitee.id,
          actorId: inviterId,
          message: 'You have been invited to join a team.',
        },
      },
    });
    return { status: 'created', invitation } as const;
  }, { isolationLevel: 'ReadCommitted' });

  if (result.status !== 'created') {
    const [status, code, message] = invitationErrors[result.status];
    sendError(response, status, code, message);
    return;
  }
  response.status(201).json({ invitation: result.invitation });
});

invitationRoutes.get('/invitations', async (request, response) => {
  const inviteeId = authenticatedSubject(request, response);
  if (!inviteeId) return;
  const paging = readPage(request, response);
  if (!paging) return;

  const invitations = await getDatabase().$transaction(async tx => {
    const invitee = await tx.user.findUnique({ where: { id: inviteeId }, select: { id: true } });
    if (!invitee) return undefined;

    return tx.invitation.findMany({
      where: { inviteeId, team: { deletedAt: null } },
      select: {
        ...invitationFields,
        team: { select: { id: true, name: true } },
        inviter: { select: { id: true, username: true, displayName: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (paging.page - 1) * paging.limit,
      take: paging.limit + 1,
    });
  }, { isolationLevel: 'RepeatableRead' });

  if (!invitations) {
    sendError(response, 401, 'UNAUTHENTICATED', 'A valid access token is required.');
    return;
  }
  response.set('Cache-Control', 'no-store').json(pageResult(invitations, paging));
});

invitationRoutes.patch('/invitations/:invitationId', async (request, response) => {
  const inviteeId = authenticatedSubject(request, response);
  if (!inviteeId) return;

  const id = z.uuid().safeParse(request.params.invitationId);
  const input = responseInput.safeParse(request.body);
  if (!id.success || !input.success) {
    sendError(response, 400, 'INVALID_INPUT', 'Provide a valid invitation ID and a status of ACCEPTED or DECLINED.');
    return;
  }

  const result = await getDatabase().$transaction(async tx => {
    const where = { id: id.data, inviteeId };
    const target = await tx.invitation.findFirst({ where, select: { teamId: true } });
    if (!target || !await lockActiveTeam(tx, target.teamId)) {
      return { status: 'invitation-not-found' } as const;
    }

    // Another response may have committed while this request waited for the team lock.
    const current = await tx.invitation.findFirst({
      where: { ...where, teamId: target.teamId },
      select: { status: true },
    });
    if (!current) return { status: 'invitation-not-found' } as const;
    if (current.status !== 'PENDING') return { status: 'invitation-not-pending' } as const;

    if (input.data.status === 'ACCEPTED') {
      if (await activeMembership(tx, target.teamId, inviteeId)) return { status: 'already-member' } as const;
      await tx.membership.create({ data: { teamId: target.teamId, userId: inviteeId, role: 'MEMBER' } });
    }

    const invitation = await tx.invitation.update({
      where: { id: id.data },
      data: { status: input.data.status, respondedAt: new Date() },
      select: invitationFields,
    });
    return { status: 'responded', invitation } as const;
  }, { isolationLevel: 'ReadCommitted' });

  if (result.status !== 'responded') {
    const [status, code, message] = invitationErrors[result.status];
    sendError(response, status, code, message);
    return;
  }
  response.set('Cache-Control', 'no-store').json({ invitation: result.invitation });
});

import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { getDatabase } from './database';
import type { Prisma } from './generated/prisma/client';
import { sendError } from './http-error';
import { activeMembership, authenticatedSubject, lockActiveTeam, readTeamId } from './team-access';

const createTeamInput = z.strictObject({ name: z.string().trim().min(1).max(100) });
const changeRoleInput = z.strictObject({ role: z.enum(['LEADER', 'MEMBER']) });
const transferOwnershipInput = z.strictObject({ newOwnerId: z.uuid() });
const positiveInteger = z.string().regex(/^[1-9]\d*$/).transform(Number);
const pagination = z.object({
  page: positiveInteger.pipe(z.number().int().max(21_474_837)).optional().default(1),
  limit: positiveInteger.pipe(z.number().int().max(100)).optional().default(20),
});
const teamFields = { id: true, name: true, boardProvisioningStatus: true } as const;
const membershipOrder = [{ createdAt: 'asc' }, { id: 'asc' }] satisfies Prisma.MembershipOrderByWithRelationInput[];
const readSnapshot = { isolationLevel: 'RepeatableRead' } as const;

function readPage(request: Request, response: Response): z.infer<typeof pagination> | undefined {
  const parsed = pagination.safeParse(request.query);
  if (parsed.success) return parsed.data;
  sendError(response, 400, 'INVALID_INPUT', 'Provide a valid page number and a limit of 1 to 100.');
}

function pageResult<T>(rows: T[], { page, limit }: z.infer<typeof pagination>) {
  return { items: rows.slice(0, limit), page, limit, hasMore: rows.length > limit };
}

async function getActiveTeamAccess(tx: Prisma.TransactionClient, teamId: string, userId: string) {
  const team = await tx.team.findFirst({ where: { id: teamId, deletedAt: null }, select: teamFields });
  if (!team) return { status: 'not-found' } as const;

  const membership = await tx.membership.findFirst({
    where: { teamId, userId, removedAt: null },
    select: { role: true },
  });
  if (!membership) return { status: 'forbidden' } as const;
  return { status: 'allowed', team, role: membership.role } as const;
}

function sendTeamAccessError(response: Response, status: 'not-found' | 'forbidden'): void {
  if (status === 'not-found') {
    sendError(response, 404, 'TEAM_NOT_FOUND', 'Team was not found.');
  } else {
    sendError(response, 403, 'TEAM_ACCESS_DENIED', 'Active team membership is required.');
  }
}

async function runOwnerChange<T>(
  teamId: string,
  actorId: string,
  change: (tx: Prisma.TransactionClient, ownerMembershipId: string) => Promise<T>,
) {
  return getDatabase().$transaction(async tx => {
    // Lock the same team row before checking permission for either role write.
    if (!await lockActiveTeam(tx, teamId)) return { status: 'not-found' } as const;

    const actor = await activeMembership(tx, teamId, actorId);
    if (actor?.role !== 'OWNER') return { status: 'owner-required' } as const;
    return change(tx, actor.id);
  }, { isolationLevel: 'ReadCommitted' });
}

const ownerChangeErrors = {
  'not-found': [404, 'TEAM_NOT_FOUND', 'Team was not found.'],
  'owner-required': [403, 'OWNER_REQUIRED', 'Only the active Owner can perform this action.'],
  'member-not-found': [404, 'MEMBER_NOT_FOUND', 'An active target membership was not found.'],
  'owner-role-protected': [403, 'OWNER_ROLE_PROTECTED', 'Use ownership transfer to change the Owner.'],
  'leader-exists': [409, 'LEADER_ALREADY_EXISTS', 'Demote the active Leader before appointing another.'],
  'already-owner': [409, 'ALREADY_OWNER', 'Choose another active team member.'],
} as const;

function sendOwnerChangeError(response: Response, status: keyof typeof ownerChangeErrors): void {
  const [code, name, message] = ownerChangeErrors[status];
  sendError(response, code, name, message);
}

export const teamRoutes = Router();

teamRoutes.post('/teams', async (request, response) => {
  const creatorId = authenticatedSubject(request, response);
  if (!creatorId) return;

  const input = createTeamInput.safeParse(request.body);
  if (!input.success) {
    sendError(response, 400, 'INVALID_INPUT', 'Provide a team name of 1 to 100 characters.');
    return;
  }

  const team = await getDatabase().$transaction(async tx => {
    const creator = await tx.user.findUnique({ where: { id: creatorId }, select: { id: true } });
    if (!creator) return undefined;

    const created = await tx.team.create({
      data: { name: input.data.name, creatorId, boardProvisioningStatus: 'PENDING' },
      select: teamFields,
    });
    await tx.membership.create({ data: { teamId: created.id, userId: creatorId, role: 'OWNER' } });
    await tx.outboxEvent.create({
      data: {
        teamId: created.id,
        correlationId: randomUUID(),
        eventType: 'TEAM_CREATED',
        status: 'PENDING',
        data: { teamId: created.id },
      },
    });
    return created;
  });
  if (!team) {
    sendError(response, 401, 'UNAUTHENTICATED', 'A valid access token is required.');
    return;
  }

  response.status(201).json({ team, role: 'OWNER' });
});

teamRoutes.get('/users/me/teams', async (request, response) => {
  const userId = authenticatedSubject(request, response);
  if (!userId) return;
  const paging = readPage(request, response);
  if (!paging) return;

  const memberships = await getDatabase().$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return undefined;
    return tx.membership.findMany({
      where: { userId, removedAt: null, team: { deletedAt: null } },
      select: { team: { select: teamFields }, role: true },
      orderBy: membershipOrder,
      skip: (paging.page - 1) * paging.limit,
      take: paging.limit + 1,
    });
  }, readSnapshot);
  if (!memberships) {
    sendError(response, 401, 'UNAUTHENTICATED', 'A valid access token is required.');
    return;
  }
  response.set('Cache-Control', 'no-store').json(pageResult(memberships, paging));
});

teamRoutes.get('/teams/:teamId', async (request, response) => {
  const userId = authenticatedSubject(request, response);
  if (!userId) return;
  const teamId = readTeamId(request.params.teamId, response);
  if (!teamId) return;

  const access = await getDatabase().$transaction(tx => getActiveTeamAccess(tx, teamId, userId), readSnapshot);
  if (access.status !== 'allowed') {
    sendTeamAccessError(response, access.status);
    return;
  }
  response.set('Cache-Control', 'no-store').json({ team: access.team, role: access.role });
});

teamRoutes.get('/teams/:teamId/members', async (request, response) => {
  const userId = authenticatedSubject(request, response);
  if (!userId) return;
  const teamId = readTeamId(request.params.teamId, response);
  if (!teamId) return;
  const paging = readPage(request, response);
  if (!paging) return;

  const result = await getDatabase().$transaction(async tx => {
    const access = await getActiveTeamAccess(tx, teamId, userId);
    if (access.status !== 'allowed') return access;

    const rows = await tx.membership.findMany({
      where: { teamId, removedAt: null },
      select: {
        userId: true,
        role: true,
        user: { select: { username: true, displayName: true } },
      },
      orderBy: membershipOrder,
      skip: (paging.page - 1) * paging.limit,
      take: paging.limit + 1,
    });
    return {
      status: 'allowed',
      members: rows.map(({ userId, role, user }) => ({ userId, role, ...user })),
    } as const;
  }, readSnapshot);
  if (result.status !== 'allowed') {
    sendTeamAccessError(response, result.status);
    return;
  }
  response.set('Cache-Control', 'no-store').json(pageResult(result.members, paging));
});

teamRoutes.patch('/teams/:teamId/members/:userId/role', async (request, response) => {
  const actorId = authenticatedSubject(request, response);
  if (!actorId) return;
  const teamId = readTeamId(request.params.teamId, response);
  if (!teamId) return;

  const target = z.uuid().safeParse(request.params.userId);
  const input = changeRoleInput.safeParse(request.body);
  if (!target.success || !input.success) {
    sendError(response, 400, 'INVALID_INPUT', 'Provide a valid user ID and a role of LEADER or MEMBER.');
    return;
  }
  const role = input.data.role;
  const result = await runOwnerChange(teamId, actorId, async tx => {
    const member = await activeMembership(tx, teamId, target.data);
    if (!member) return { status: 'member-not-found' } as const;
    if (member.role === 'OWNER') return { status: 'owner-role-protected' } as const;
    if (member.role === role) return { status: 'updated', userId: member.userId, role } as const;

    if (role === 'LEADER') {
      const leader = await tx.membership.findFirst({
        where: { teamId, removedAt: null, role: 'LEADER' },
        select: { id: true },
      });
      if (leader) return { status: 'leader-exists' } as const;
    }
    await tx.membership.update({ where: { id: member.id }, data: { role } });
    return { status: 'updated', userId: member.userId, role } as const;
  });
  if (result.status !== 'updated') {
    sendOwnerChangeError(response, result.status);
    return;
  }
  response.json({ userId: result.userId, role: result.role });
});

teamRoutes.patch('/teams/:teamId/ownership', async (request, response) => {
  const actorId = authenticatedSubject(request, response);
  if (!actorId) return;
  const teamId = readTeamId(request.params.teamId, response);
  if (!teamId) return;

  const input = transferOwnershipInput.safeParse(request.body);
  if (!input.success) {
    sendError(response, 400, 'INVALID_INPUT', 'Provide a valid new Owner user ID.');
    return;
  }
  const newOwnerId = input.data.newOwnerId;
  const result = await runOwnerChange(teamId, actorId, async (tx, ownerMembershipId) => {
    const target = await activeMembership(tx, teamId, newOwnerId);
    if (!target) return { status: 'member-not-found' } as const;
    if (target.id === ownerMembershipId) return { status: 'already-owner' } as const;

    await tx.membership.update({ where: { id: ownerMembershipId }, data: { role: 'MEMBER' } });
    await tx.membership.update({ where: { id: target.id }, data: { role: 'OWNER' } });
    return { status: 'transferred' } as const;
  });
  if (result.status !== 'transferred') {
    sendOwnerChangeError(response, result.status);
    return;
  }
  response.json({ teamId, ownerId: newOwnerId, previousOwnerId: actorId });
});

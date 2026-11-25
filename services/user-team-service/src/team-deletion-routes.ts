import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';

import { getDatabase } from './database';
import type { Prisma } from './generated/prisma/client';
import { sendError } from './http-error';
import { activeMembership, authenticatedSubject, lockActiveTeam, readTeamId } from './team-access';

export type ActiveTaskCheck = (teamId: string, userId: string) => Promise<number>;

const deletionErrors = {
  'team-not-found': [404, 'TEAM_NOT_FOUND', 'Team was not found.'],
  'member-not-found': [404, 'MEMBER_NOT_FOUND', 'An active target membership was not found.'],
  'owner-required': [403, 'OWNER_REQUIRED', 'Only the active Owner can perform this action.'],
  forbidden: [403, 'TEAM_ACCESS_DENIED', 'The caller cannot remove this member.'],
  'owner-protected': [403, 'OWNER_ROLE_PROTECTED', 'The Owner cannot be removed.'],
  'membership-changed': [409, 'MEMBERSHIP_CHANGED', 'The target membership changed. Retry the request.'],
  'active-tasks': [409, 'MEMBER_HAS_ACTIVE_TASKS', 'Reassign or complete the member’s active tasks first.'],
  'check-unavailable': [503, 'TASK_CHECK_UNAVAILABLE', 'The member’s active tasks could not be checked.'],
} as const;

function sendDeletionError(response: Response, result: keyof typeof deletionErrors): void {
  const [status, code, message] = deletionErrors[result];
  sendError(response, status, code, message);
}

async function assessRemoval(tx: Prisma.TransactionClient, teamId: string, actorId: string, userId: string) {
  const actor = await activeMembership(tx, teamId, actorId);
  if (actor?.role !== 'OWNER' && actor?.role !== 'LEADER') return { status: 'forbidden' } as const;
  const target = await activeMembership(tx, teamId, userId);
  if (!target) return { status: 'member-not-found' } as const;
  if (target.role === 'OWNER') return { status: 'owner-protected' } as const;
  if (target.role === 'LEADER' && actor.role !== 'OWNER') return { status: 'forbidden' } as const;
  return { status: 'eligible', membershipId: target.id } as const;
}

async function taskRemovalStatus(check: ActiveTaskCheck | undefined, teamId: string, userId: string) {
  try {
    const count = await check?.(teamId, userId);
    if (count === undefined || !Number.isSafeInteger(count) || count < 0) return 'check-unavailable';
    return count === 0 ? 'clear' : 'active-tasks';
  } catch {
    return 'check-unavailable';
  }
}

export function createTeamDeletionRoutes(checkActiveTasks?: ActiveTaskCheck): Router {
  const routes = Router();

  routes.delete('/teams/:teamId', async (request, response) => {
    const actorId = authenticatedSubject(request, response);
    if (!actorId) return;
    const teamId = readTeamId(request.params.teamId, response);
    if (!teamId) return;

    const status = await getDatabase().$transaction(async tx => {
      if (!await lockActiveTeam(tx, teamId)) return 'team-not-found';
      const actor = await activeMembership(tx, teamId, actorId);
      if (actor?.role !== 'OWNER') return 'owner-required';

      await tx.team.update({ where: { id: teamId }, data: { deletedAt: new Date() } });
      return 'deleted';
    }, { isolationLevel: 'ReadCommitted' });
    if (status !== 'deleted') {
      sendDeletionError(response, status);
      return;
    }
    response.status(204).end();
  });

  routes.delete('/teams/:teamId/members/:userId', async (request, response) => {
    const actorId = authenticatedSubject(request, response);
    if (!actorId) return;
    const teamId = readTeamId(request.params.teamId, response);
    if (!teamId) return;
    const target = z.uuid().safeParse(request.params.userId);
    if (!target.success) {
      sendError(response, 400, 'INVALID_INPUT', 'Provide a valid user ID.');
      return;
    }
    const userId = target.data;
    const db = getDatabase();
    const candidate = await db.$transaction(async tx => {
      const team = await tx.team.findFirst({ where: { id: teamId, deletedAt: null }, select: { id: true } });
      if (!team) return { status: 'team-not-found' } as const;
      return assessRemoval(tx, teamId, actorId, userId);
    }, { isolationLevel: 'RepeatableRead' });
    if (candidate.status !== 'eligible') {
      sendDeletionError(response, candidate.status);
      return;
    }

    // The Task Service call runs outside any database transaction.
    const taskStatus = await taskRemovalStatus(checkActiveTasks, teamId, userId);
    if (taskStatus !== 'clear') {
      sendDeletionError(response, taskStatus);
      return;
    }

    const status = await db.$transaction(async tx => {
      if (!await lockActiveTeam(tx, teamId)) return 'team-not-found';
      const current = await assessRemoval(tx, teamId, actorId, userId);
      if (current.status !== 'eligible') return current.status;
      if (current.membershipId !== candidate.membershipId) return 'membership-changed';

      await tx.membership.update({ where: { id: current.membershipId }, data: { removedAt: new Date() } });
      return 'removed';
    }, { isolationLevel: 'ReadCommitted' });
    if (status !== 'removed') {
      sendDeletionError(response, status);
      return;
    }
    response.status(204).end();
  });

  return routes;
}

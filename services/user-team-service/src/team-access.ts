import type { Request, Response } from 'express';
import { z } from 'zod';

import { readAccessSubject } from './auth-session';
import type { Prisma } from './generated/prisma/client';
import { sendError } from './http-error';

export function authenticatedSubject(request: Request, response: Response): string | undefined {
  const subject = readAccessSubject(request.get('authorization'));
  if (!subject) sendError(response, 401, 'UNAUTHENTICATED', 'A valid access token is required.');
  return subject;
}

export function readTeamId(value: unknown, response: Response): string | undefined {
  const parsed = z.uuid().safeParse(value);
  if (parsed.success) return parsed.data;
  sendError(response, 400, 'INVALID_INPUT', 'Provide a valid team ID.');
}

export function activeMembership(tx: Prisma.TransactionClient, teamId: string, userId: string) {
  return tx.membership.findFirst({
    where: { teamId, userId, removedAt: null },
    select: { id: true, userId: true, role: true },
  });
}

export async function lockActiveTeam(tx: Prisma.TransactionClient, teamId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Team"
    WHERE "id" = ${teamId}::uuid AND "deletedAt" IS NULL
    FOR UPDATE
  `;
  return rows.length !== 0;
}

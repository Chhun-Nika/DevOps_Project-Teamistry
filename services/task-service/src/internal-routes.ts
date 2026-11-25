import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from './generated/prisma/client';

function authorized(request: { get(name: string): string | undefined }): boolean {
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  return Boolean(expected && request.get('X-Service-Token') === expected);
}

export function internalRoutes(db: PrismaClient): Router {
  const routes = Router();
  routes.get('/internal/teams/:teamId/members/:userId/active-task-summary', async (request, response) => {
    if (!authorized(request)) {
      response.status(401).json({ error: 'Invalid service token.' });
      return;
    }
    const teamId = z.uuid().safeParse(request.params.teamId);
    const userId = z.uuid().safeParse(request.params.userId);
    if (!teamId.success || !userId.success) {
      response.status(400).json({ error: 'Invalid team or user ID.' });
      return;
    }
    const activeTaskCount = await db.task.count({
      where: {
        teamId: teamId.data,
        assigneeId: userId.data,
        deletedAt: null,
        status: { isDone: false, deletedAt: null }
      }
    });
    response.json({ teamId: teamId.data, userId: userId.data, activeTaskCount });
  });
  return routes;
}

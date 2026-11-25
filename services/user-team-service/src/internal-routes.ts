import { Router } from 'express';
import { z } from 'zod';
import { getDatabase } from './database';

function authorized(request: { get(name: string): string | undefined }): boolean {
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  return Boolean(expected && request.get('X-Service-Token') === expected);
}

export function internalRoutes(): Router {
  const routes = Router();

  routes.get('/internal/teams/:teamId/members/:userId', async (request, response) => {
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
    const membership = await getDatabase().membership.findFirst({
      where: { teamId: teamId.data, userId: userId.data, removedAt: null },
      select: { userId: true, teamId: true, role: true }
    });
    if (!membership) {
      response.json({ userId: userId.data, teamId: teamId.data, isActiveMember: false });
      return;
    }
    response.json({ ...membership, isActiveMember: true });
  });

  return routes;
}

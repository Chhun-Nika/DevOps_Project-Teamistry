import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { isTrustedAuthOrigin } from './auth-browser';
import { authErrorHandler, authRoutes } from './auth-routes';
import { invitationRoutes } from './invitation-routes';
import { createTeamDeletionRoutes } from './team-deletion-routes';
import type { ActiveTaskCheck } from './team-deletion-routes';
import { teamRoutes } from './team-routes';

export function createApp(checkActiveTasks?: ActiveTaskCheck) {
  const app = express();

  app.use(helmet());
  app.use(cors({
    origin: (origin, callback) => callback(null, isTrustedAuthOrigin(origin)),
    credentials: true,
  }));
  app.use(express.json());

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok', service: 'user-team-service' });
  });

  app.use(authRoutes);
  app.use(teamRoutes);
  app.use(invitationRoutes);
  app.use(createTeamDeletionRoutes(checkActiveTasks));
  app.use(authErrorHandler);
  return app;
}

export const app = createApp();

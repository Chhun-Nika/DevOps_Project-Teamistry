import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { isTrustedAuthOrigin } from './auth-browser';
import { authErrorHandler, authRoutes } from './auth-routes';

export const app = express();

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
app.use(authErrorHandler);

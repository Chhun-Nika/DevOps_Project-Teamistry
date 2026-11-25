import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';

import { AuthConfigurationError, isTrustedAuthOrigin } from './auth-browser';
import { issueSession, logoutSession, readAccessSubject, rotateSession } from './auth-session';
import { getDatabase } from './database';
import { Prisma } from './generated/prisma/client';
import { finishGoogleSignIn, GoogleSignInError, startGoogleSignIn } from './google-auth';
import { sendError } from './http-error';

const HASH_COST = 12;
// Keep password verification work comparable when an account has no password.
const FALLBACK_HASH = '$2b$12$qR8pU5mkLZOyhFtG/AVb.usGnIjdzT8Ejr0jXjXEMuRbawmAlonKC';
const email = z.string().trim().max(254).email().toLowerCase();
const passwordWithinBcryptLimit = z.string().refine(value => !bcrypt.truncates(value));
const signupInput = z.strictObject({
  username: z.string().trim().min(3).max(30),
  email,
  password: passwordWithinBcryptLimit.refine(value => value.length >= 8),
  displayName: z.string().trim().max(100).optional(),
});
const loginInput = z.strictObject({
  email,
  password: passwordWithinBcryptLimit.refine(value => value.length > 0),
});
const profileFields = { id: true, username: true, email: true, displayName: true } as const;

export const authRoutes = Router();

const requireTrustedOrigin: RequestHandler = (request, response, next) => {
  response.set('Cache-Control', 'no-store');
  if (!isTrustedAuthOrigin(request.get('origin'))) {
    sendError(response, 403, 'UNTRUSTED_ORIGIN', 'Request origin is not allowed.');
    return;
  }
  next();
};

authRoutes.post('/auth/signup', async (request, response) => {
  const input = signupInput.safeParse(request.body);
  if (!input.success) {
    sendError(response, 400, 'INVALID_INPUT', 'Check username, email, password, and display name.');
    return;
  }

  const { password, ...profile } = input.data;
  const passwordHash = await bcrypt.hash(password, HASH_COST);
  try {
    const user = await getDatabase().user.create({
      data: { ...profile, passwordHash },
      select: profileFields,
    });
    response.status(201).json({ user });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      sendError(response, 409, 'ACCOUNT_CONFLICT', 'Username or email is already registered.');
      return;
    }
    throw error;
  }
});

authRoutes.post('/auth/login', async (request, response) => {
  const input = loginInput.safeParse(request.body);
  if (!input.success) {
    sendError(response, 400, 'INVALID_INPUT', 'Provide a valid email and password.');
    return;
  }

  const user = await getDatabase().user.findUnique({
    where: { email: input.data.email },
    select: { id: true, passwordHash: true },
  });
  const matches = await bcrypt.compare(input.data.password, user?.passwordHash ?? FALLBACK_HASH);
  if (!user?.passwordHash || !matches) {
    sendError(response, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    return;
  }

  const accessToken = await issueSession(user.id, response);
  response.set('Cache-Control', 'no-store').json({ accessToken });
});

authRoutes.get('/auth/google', async (request, response) => {
  response.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  await startGoogleSignIn(request, response);
});

authRoutes.get('/auth/google/callback', async (request, response) => {
  response.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  await finishGoogleSignIn(request, response);
});

authRoutes.post('/auth/refresh', requireTrustedOrigin, async (request, response) => {
  const accessToken = await rotateSession(request.get('cookie'), response);
  if (!accessToken) {
    sendError(response, 401, 'INVALID_REFRESH_SESSION', 'A valid refresh session is required.');
    return;
  }
  response.json({ accessToken });
});

authRoutes.post('/auth/logout', requireTrustedOrigin, async (request, response) => {
  const revoked = await logoutSession(request.get('cookie'), response);
  if (!revoked) {
    sendError(response, 401, 'INVALID_REFRESH_SESSION', 'A valid refresh session is required.');
    return;
  }
  response.status(204).end();
});

authRoutes.get('/users/me', async (request, response) => {
  const subject = readAccessSubject(request.get('authorization'));
  const user = subject && await getDatabase().user.findUnique({
    where: { id: subject },
    select: profileFields,
  });
  if (!user) {
    sendError(response, 401, 'UNAUTHENTICATED', 'A valid access token is required.');
    return;
  }

  response.set('Cache-Control', 'no-store').json({ user });
});

export const authErrorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
  } else if (error instanceof AuthConfigurationError) {
    sendError(response, 503, 'AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable.');
  } else if (error instanceof GoogleSignInError) {
    sendError(response, 401, error.code, error.message);
  } else if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    sendError(response, 400, 'INVALID_INPUT', 'Request body is not valid JSON.');
  } else {
    sendError(response, 500, 'INTERNAL_ERROR', 'The request could not be completed.');
  }
};

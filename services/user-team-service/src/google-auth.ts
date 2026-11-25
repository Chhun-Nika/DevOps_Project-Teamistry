import { createHash, randomBytes } from 'node:crypto';

import { parse } from 'cookie';
import type { Request, Response } from 'express';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { AuthConfigurationError, isTrustedAuthOrigin, refreshCookieOptions } from './auth-browser';
import { getActiveRefreshUserId, getJwtSecret, issueSession } from './auth-session';
import { getDatabase } from './database';
import { Prisma } from './generated/prisma/client';

const stateCookie = 'googleOAuth';
const stateTtl = 10 * 60;
const usernameLimit = 30;
const numberedUsernameAttempts = 10;
const randomUsernameAttempts = 3;
const randomValue = () => randomBytes(32).toString('base64url');
const flowClaims = z.object({
  tokenUse: z.literal('google-oauth'),
  state: z.string(),
  nonce: z.string(),
  verifier: z.string(),
  linkUserId: z.uuid().optional(),
  exp: z.number(),
});
const googleClaims = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().trim().max(254).email().toLowerCase(),
  email_verified: z.literal(true),
  nonce: z.string(),
  name: z.string().optional(),
});

export class GoogleSignInError extends Error {
  constructor(readonly code: 'GOOGLE_SIGN_IN_FAILED' | 'GOOGLE_LINK_REQUIRED' = 'GOOGLE_SIGN_IN_FAILED') {
    super(code === 'GOOGLE_LINK_REQUIRED'
      ? 'Sign in to your Teamisty account first, then start Google account linking.'
      : 'Google sign-in could not be completed.');
  }
}

function configuredUrl(value: string | undefined): URL {
  try {
    const url = new URL(value ?? '');
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol === 'https:' || localHttp) && !url.username && !url.password && !url.search && !url.hash) {
      return url;
    }
  } catch {
    // Report configuration problems without exposing configured values.
  }
  throw new AuthConfigurationError('Invalid Google OAuth URL');
}

function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new AuthConfigurationError('Google OAuth is not configured');

  const redirect = configuredUrl(process.env.GOOGLE_REDIRECT_URI);
  const success = configuredUrl(process.env.GOOGLE_SIGN_IN_SUCCESS_URL);
  const cookie = refreshCookieOptions();
  const callbackPath = `${cookie.path}/google/callback`;
  if (redirect.pathname !== callbackPath || !isTrustedAuthOrigin(success.origin)) {
    throw new AuthConfigurationError('Google OAuth URLs do not match the configured callback and frontend');
  }
  return {
    clientId,
    client: new OAuth2Client(clientId, clientSecret, redirect.href),
    successUrl: success.href,
    stateOptions: { httpOnly: true, secure: true, sameSite: 'lax' as const, path: callbackPath },
    secret: getJwtSecret(),
  };
}

export async function startGoogleSignIn(request: Request, response: Response): Promise<void> {
  const config = googleConfig();
  const wantsLink = request.query.link === '1';
  const linkUserId = wantsLink ? await getActiveRefreshUserId(request.get('cookie')) : undefined;
  if (wantsLink && !linkUserId) throw new GoogleSignInError('GOOGLE_LINK_REQUIRED');

  const state = randomValue();
  const nonce = randomValue();
  const verifier = randomValue();
  const flow = jwt.sign({ tokenUse: 'google-oauth', state, nonce, verifier, linkUserId }, config.secret, {
    algorithm: 'HS256',
    expiresIn: stateTtl,
  });
  const location = config.client.generateAuthUrl({
    response_type: 'code',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account',
    state,
    nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: CodeChallengeMethod.S256,
  });
  response.cookie(stateCookie, flow, { ...config.stateOptions, maxAge: stateTtl * 1000 });
  response.redirect(302, location);
}

function verifyFlow(request: Request, secret: string): z.infer<typeof flowClaims> {
  const cookie = parse(request.get('cookie') ?? '')[stateCookie];
  if (!cookie) throw new GoogleSignInError();

  try {
    const flow = flowClaims.parse(jwt.verify(cookie, secret, { algorithms: ['HS256'] }));
    if (flow.state === request.query.state) return flow;
  } catch {
    // Invalid or expired state cannot authorize a token exchange.
  }
  throw new GoogleSignInError();
}

function usernameBase(name: string | undefined): string | undefined {
  const base = (name ?? '').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^[\p{M}-]+|-+$/gu, '');
  if (!/[\p{L}\p{N}]/u.test(base)) return undefined;
  return base.length < 3 ? `member-${base}` : base;
}

function fitUsername(base: string, suffix: string): string {
  const prefix = base.slice(0, usernameLimit - suffix.length).replace(/[\p{Cs}-]+$/gu, '');
  return prefix + suffix;
}

async function createGoogleUser(identity: z.infer<typeof googleClaims>): Promise<string> {
  const db = getDatabase();
  const base = usernameBase(identity.name);
  const numberedAttempts = base ? numberedUsernameAttempts : 0;

  for (let attempt = 1; attempt <= numberedAttempts + randomUsernameAttempts; attempt++) {
    const suffix = attempt <= numberedAttempts
      ? (attempt === 1 ? '' : `-${attempt}`)
      : `-${randomBytes(4).toString('hex')}`;
    const username = fitUsername(base ?? 'member', suffix);
    try {
      const user = await db.user.create({
        data: {
          username,
          email: identity.email,
          googleSubject: identity.sub,
          displayName: identity.name?.trim().slice(0, 100),
        },
        select: { id: true },
      });
      return user.id;
    } catch (error) {
      // A competing signup may claim the username. Other unique conflicts still fail sign-in.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      if (!await db.user.findUnique({ where: { username }, select: { id: true } })) throw error;
    }
  }
  throw new GoogleSignInError();
}

async function resolveGoogleUser(identity: z.infer<typeof googleClaims>, linkUserId: string | undefined): Promise<string> {
  const db = getDatabase();
  const linked = await db.user.findUnique({ where: { googleSubject: identity.sub }, select: { id: true } });
  if (linked) {
    if (linkUserId && linked.id !== linkUserId) throw new GoogleSignInError();
    return linked.id;
  }

  const existing = await db.user.findUnique({
    where: { email: identity.email },
    select: { id: true, googleSubject: true },
  });
  if (existing) {
    // An email match alone does not prove control of the existing Teamisty account.
    if (!linkUserId || existing.id !== linkUserId) throw new GoogleSignInError('GOOGLE_LINK_REQUIRED');
    const { count } = await db.user.updateMany({
      where: { id: existing.id, email: identity.email, googleSubject: null },
      data: { googleSubject: identity.sub },
    });
    if (count !== 1) throw new GoogleSignInError();
    return existing.id;
  }

  if (linkUserId) throw new GoogleSignInError();
  return createGoogleUser(identity);
}

export async function finishGoogleSignIn(request: Request, response: Response): Promise<void> {
  const config = googleConfig();
  const flow = verifyFlow(request, config.secret);
  response.clearCookie(stateCookie, config.stateOptions);
  const code = request.query.code;
  if (request.query.error !== undefined || typeof code !== 'string' || !code) throw new GoogleSignInError();
  if (flow.linkUserId && await getActiveRefreshUserId(request.get('cookie')) !== flow.linkUserId) {
    throw new GoogleSignInError('GOOGLE_LINK_REQUIRED');
  }

  let identity: z.infer<typeof googleClaims>;
  try {
    const { tokens } = await config.client.getToken({ code, codeVerifier: flow.verifier });
    if (!tokens.id_token) throw new GoogleSignInError();
    const ticket = await config.client.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId });
    identity = googleClaims.parse(ticket.getPayload());
    if (identity.nonce !== flow.nonce) throw new GoogleSignInError();
  } catch {
    throw new GoogleSignInError();
  }

  let userId: string;
  try {
    userId = await resolveGoogleUser(identity, flow.linkUserId);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new GoogleSignInError();
    }
    throw error;
  }
  await issueSession(userId, response);
  response.redirect(303, config.successUrl);
}

import { createHash, randomUUID } from 'node:crypto';

import { parse } from 'cookie';
import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { AuthConfigurationError, refreshCookieOptions } from './auth-browser';
import { getDatabase } from './database';
import type { Prisma } from './generated/prisma/client';

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
const REFRESH_COOKIE = 'refreshToken';
const uuid = z.uuid();

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.startsWith('replace-with-') || Buffer.byteLength(secret.trim()) < 32) {
    throw new AuthConfigurationError('JWT_SECRET is missing or too short');
  }
  return secret;
}

function hashRefreshId(refreshId: string): string {
  return createHash('sha256').update(refreshId).digest('hex');
}

function newSession(userId: string) {
  const secret = getJwtSecret();
  const refreshId = randomUUID();
  const issuedAt = Math.floor(Date.now() / 1000);
  const accessToken = jwt.sign({ tokenUse: 'access', iat: issuedAt }, secret, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: ACCESS_TTL_SECONDS,
  });
  const refreshToken = jwt.sign({ tokenUse: 'refresh', iat: issuedAt }, secret, {
    algorithm: 'HS256',
    subject: userId,
    jwtid: refreshId,
    expiresIn: REFRESH_TTL_SECONDS,
  });

  return {
    accessToken,
    refreshToken,
    data: {
      userId,
      tokenHash: hashRefreshId(refreshId),
      expiresAt: new Date((issuedAt + REFRESH_TTL_SECONDS) * 1000),
    },
  };
}

function sendRefreshCookie(response: Response, token: string, options: CookieOptions): void {
  response.cookie(REFRESH_COOKIE, token, {
    ...options,
    maxAge: REFRESH_TTL_SECONDS * 1000,
  });
}

export async function issueSession(userId: string, response: Response): Promise<string> {
  const options = refreshCookieOptions();
  const session = newSession(userId);
  await getDatabase().refreshSession.create({ data: session.data });
  sendRefreshCookie(response, session.refreshToken, options);
  return session.accessToken;
}

function readRefreshSession(cookieHeader: string | undefined) {
  const token = cookieHeader && parse(cookieHeader)[REFRESH_COOKIE];
  if (!token) return undefined;

  const secret = getJwtSecret();
  try {
    const claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof claims === 'string' || claims.tokenUse !== 'refresh' || typeof claims.exp !== 'number') {
      return undefined;
    }
    const subject = uuid.safeParse(claims.sub);
    const identifier = uuid.safeParse(claims.jti);
    if (!subject.success || !identifier.success) return undefined;

    return { userId: subject.data, tokenHash: hashRefreshId(identifier.data) };
  } catch {
    return undefined;
  }
}

async function revokeActiveSession(
  db: Pick<Prisma.TransactionClient, 'refreshSession'>,
  session: NonNullable<ReturnType<typeof readRefreshSession>>,
): Promise<boolean> {
  const now = new Date();
  const { count } = await db.refreshSession.updateMany({
    where: { ...session, revokedAt: null, expiresAt: { gt: now } },
    data: { revokedAt: now },
  });
  return count === 1;
}

export async function rotateSession(cookieHeader: string | undefined, response: Response): Promise<string | undefined> {
  const current = readRefreshSession(cookieHeader);
  if (!current) return undefined;

  const options = refreshCookieOptions();
  const replacement = newSession(current.userId);
  const rotated = await getDatabase().$transaction(async tx => {
    // Only the request that claims the active row can create a successor.
    if (!await revokeActiveSession(tx, current)) return false;
    await tx.refreshSession.create({ data: replacement.data });
    return true;
  });
  if (!rotated) return undefined;

  sendRefreshCookie(response, replacement.refreshToken, options);
  return replacement.accessToken;
}

export async function logoutSession(cookieHeader: string | undefined, response: Response): Promise<boolean> {
  const current = readRefreshSession(cookieHeader);
  if (!current) return false;

  const options = refreshCookieOptions();
  if (!await revokeActiveSession(getDatabase(), current)) return false;

  response.clearCookie(REFRESH_COOKIE, options);
  return true;
}

export function readAccessSubject(authorization: string | undefined): string | undefined {
  const token = authorization?.match(/^Bearer +(\S+)$/i)?.[1];
  if (!token) return undefined;

  const secret = getJwtSecret();
  try {
    const claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof claims === 'string' || claims.tokenUse !== 'access' || typeof claims.exp !== 'number') {
      return undefined;
    }

    const subject = uuid.safeParse(claims.sub);
    return subject.success ? subject.data : undefined;
  } catch {
    return undefined;
  }
}

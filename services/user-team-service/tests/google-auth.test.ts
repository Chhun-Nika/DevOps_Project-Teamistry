import { createHash } from 'node:crypto';

import { LoginTicket, OAuth2Client } from 'google-auth-library';
import type { TokenPayload } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { app } from '../src/app';
import { getDatabase } from '../src/database';

jest.mock('../src/database', () => ({ getDatabase: jest.fn() }));

const origin = 'http://localhost:5173';
const successUrl = `${origin}/auth/google/callback`;
const secret = 'teamisty-google-test-key-not-for-runtime';
const userId = '49374d77-4185-4b60-9f97-7d68c60f5b21';
const cookie = `refreshToken=${jwt.sign({ tokenUse: 'refresh' }, secret, {
  algorithm: 'HS256',
  subject: userId,
  jwtid: '526ee6ef-171d-4273-a8b6-22d1f32db785',
  expiresIn: 3600,
})}`;
const db = {
  user: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
  refreshSession: { create: jest.fn(), findFirst: jest.fn() },
};
const originalEnv = process.env;
let verify: jest.SpiedFunction<OAuth2Client['verifyIdToken']>;
let exchange: jest.SpiedFunction<OAuth2Client['getToken']>;

beforeEach(() => {
  jest.resetAllMocks();
  process.env = {
    ...originalEnv,
    JWT_SECRET: secret,
    AUTH_TRUSTED_ORIGINS: origin,
    AUTH_REFRESH_COOKIE_PATH: '/auth',
    AUTH_REFRESH_COOKIE_SAME_SITE: 'lax',
    GOOGLE_CLIENT_ID: 'example-client',
    GOOGLE_CLIENT_SECRET: 'example-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:3001/auth/google/callback',
    GOOGLE_SIGN_IN_SUCCESS_URL: successUrl,
  };
  jest.mocked(getDatabase).mockReturnValue(db as unknown as ReturnType<typeof getDatabase>);
  exchange = jest.spyOn(OAuth2Client.prototype, 'getToken')
    .mockImplementation(async () => ({ tokens: { id_token: 'example-issued-id-token' }, res: null }));
  verify = jest.spyOn(OAuth2Client.prototype, 'verifyIdToken');
});

afterEach(() => {
  process.env = originalEnv;
  jest.restoreAllMocks();
});

async function start(link = false) {
  const req = request(app).get('/auth/google' + (link ? '?link=1' : ''));
  if (link) req.set('Cookie', cookie);
  const response = await req;
  expect(response.status).toBe(302);
  const url = new URL(response.headers.location);
  const [flow] = response.headers['set-cookie'] as unknown as string[];
  expect(url.hostname).toBe('accounts.google.com');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(flow).toContain('Path=/auth/google/callback');
  expect(flow).toContain('HttpOnly; Secure; SameSite=Lax');
  return { url, flow: flow.split(';')[0] };
}

function stubIdentity(url: URL, overrides: Partial<TokenPayload> = {}): void {
  verify.mockImplementation(async () => new LoginTicket(undefined, {
    iss: 'https://accounts.google.com',
    aud: 'example-client',
    sub: 'google-subject',
    email: 'account@example.invalid',
    email_verified: true,
    nonce: url.searchParams.get('nonce')!,
    iat: 1,
    exp: 2,
    ...overrides,
  }));
}

function finish(url: URL, flow: string) {
  return request(app).get('/auth/google/callback')
    .query({ code: 'example-code', state: url.searchParams.get('state')! })
    .set('Cookie', flow);
}

it('creates a Google account and hands off a refresh session without URL tokens', async () => {
  const { url, flow } = await start();
  stubIdentity(url, { name: 'Example Account' });
  db.user.findUnique.mockResolvedValue(null);
  db.user.create.mockResolvedValue({ id: userId });
  const response = await finish(url, flow);

  expect(response.status).toBe(303);
  expect(response.headers.location).toBe(successUrl);
  const cookies = response.headers['set-cookie'] as unknown as string[];
  expect(cookies.some(value => value.startsWith('googleOAuth=;'))).toBe(true);
  expect(cookies.some(value => value.startsWith('refreshToken='))).toBe(true);
  const verifier = exchange.mock.calls[0][0] as { codeVerifier: string };
  expect(createHash('sha256').update(verifier.codeVerifier).digest('base64url'))
    .toBe(url.searchParams.get('code_challenge'));
  expect(verify).toHaveBeenCalledWith({ idToken: 'example-issued-id-token', audience: 'example-client' });
  expect(db.user.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ googleSubject: 'google-subject', email: 'account@example.invalid' }),
  }));
  expect(db.refreshSession.create).toHaveBeenCalledTimes(1);
});

it('signs in a previously linked subject without matching email', async () => {
  const { url, flow } = await start();
  stubIdentity(url, { email: 'changed@example.invalid' });
  db.user.findUnique.mockResolvedValueOnce({ id: userId });

  expect((await finish(url, flow)).status).toBe(303);
  expect(db.user.findUnique).toHaveBeenCalledTimes(1);
  expect(db.user.create).not.toHaveBeenCalled();
});

it('rejects mismatched state before exchanging the code', async () => {
  const { url, flow } = await start();
  url.searchParams.set('state', 'wrong-state');
  expect((await finish(url, flow)).status).toBe(401);
  expect(exchange).not.toHaveBeenCalled();
});

it.each([{ email_verified: false }, { nonce: 'wrong-nonce' }])('rejects invalid Google identity claims', async overrides => {
  const { url, flow } = await start();
  stubIdentity(url, overrides);
  expect((await finish(url, flow)).status).toBe(401);
  expect(db.user.findUnique).not.toHaveBeenCalled();
});

it('requires a Teamisty session before attaching a matching Google email', async () => {
  const { url, flow } = await start();
  stubIdentity(url);
  db.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: userId, googleSubject: null });
  const response = await finish(url, flow);
  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe('GOOGLE_LINK_REQUIRED');
  expect(db.user.updateMany).not.toHaveBeenCalled();
  expect(db.refreshSession.create).not.toHaveBeenCalled();
});

it('links a matching account when the same local session is active at start and callback', async () => {
  db.refreshSession.findFirst.mockResolvedValue({ userId });
  const { url, flow } = await start(true);
  stubIdentity(url);
  db.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: userId, googleSubject: null });
  db.user.updateMany.mockResolvedValue({ count: 1 });

  expect((await finish(url, flow + '; ' + cookie)).status).toBe(303);
  expect(db.refreshSession.findFirst).toHaveBeenCalledTimes(2);
  expect(db.user.updateMany).toHaveBeenCalledWith({
    where: { id: userId, email: 'account@example.invalid', googleSubject: null },
    data: { googleSubject: 'google-subject' },
  });
});

it('rejects linking if the local session is revoked before the callback', async () => {
  db.refreshSession.findFirst.mockResolvedValueOnce({ userId }).mockResolvedValueOnce(null);
  const { url, flow } = await start(true);
  const response = await finish(url, flow + '; ' + cookie);
  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe('GOOGLE_LINK_REQUIRED');
  expect(exchange).not.toHaveBeenCalled();
  expect(db.user.updateMany).not.toHaveBeenCalled();
});

it('reports unavailable when Google credentials are absent', async () => {
  delete process.env.GOOGLE_CLIENT_ID;
  const response = await request(app).get('/auth/google');
  expect(response.status).toBe(503);
  expect(response.body.error.code).toBe('AUTH_UNAVAILABLE');
});

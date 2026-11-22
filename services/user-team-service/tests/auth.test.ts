import { createHash } from 'node:crypto';

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { app } from '../src/app';
import { getDatabase } from '../src/database';
import { Prisma } from '../src/generated/prisma/client';

jest.mock('../src/database', () => ({ getDatabase: jest.fn() }));

const store = {
  user: { create: jest.fn(), findUnique: jest.fn() },
  refreshSession: { create: jest.fn(), updateMany: jest.fn() },
  $transaction: jest.fn(),
};
const secret = 'teamisty-auth-test-key-not-for-runtime';
const trustedOrigin = 'https://teamisty.example.invalid';
const password = 'valid-test-password';
const user = {
  id: '49374d77-4185-4b60-9f97-7d68c60f5b21',
  username: 'alice',
  email: 'alice@example.invalid',
  displayName: null,
};
const originalSecret = process.env.JWT_SECRET;
const originalOrigins = process.env.AUTH_TRUSTED_ORIGINS;
const originalPath = process.env.AUTH_REFRESH_COOKIE_PATH;
const originalSameSite = process.env.AUTH_REFRESH_COOKIE_SAME_SITE;
let passwordHash: string;

beforeAll(async () => {
  process.env.JWT_SECRET = secret;
  passwordHash = await bcrypt.hash(password, 4);
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.AUTH_TRUSTED_ORIGINS = trustedOrigin;
  delete process.env.AUTH_REFRESH_COOKIE_PATH;
  delete process.env.AUTH_REFRESH_COOKIE_SAME_SITE;
  store.$transaction.mockImplementation(async operation => operation(store));
  jest.mocked(getDatabase).mockReturnValue(store as unknown as ReturnType<typeof getDatabase>);
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  if (originalOrigins === undefined) delete process.env.AUTH_TRUSTED_ORIGINS;
  else process.env.AUTH_TRUSTED_ORIGINS = originalOrigins;
  if (originalPath === undefined) delete process.env.AUTH_REFRESH_COOKIE_PATH;
  else process.env.AUTH_REFRESH_COOKIE_PATH = originalPath;
  if (originalSameSite === undefined) delete process.env.AUTH_REFRESH_COOKIE_SAME_SITE;
  else process.env.AUTH_REFRESH_COOKIE_SAME_SITE = originalSameSite;
});

it('creates a public profile and stores a bcrypt hash', async () => {
  store.user.create.mockResolvedValueOnce(user);
  const response = await request(app).post('/auth/signup').send({
    username: ' alice ',
    email: 'ALICE@example.invalid',
    password,
  });

  expect(response.status).toBe(201);
  expect(response.body).toEqual({ user });
  const { data } = store.user.create.mock.calls[0][0];
  expect(data).toMatchObject({ username: user.username, email: user.email });
  expect(data.password).toBeUndefined();
  expect(data.passwordHash).not.toBe(password);
  expect(await bcrypt.compare(password, data.passwordHash)).toBe(true);
});

it('rejects duplicate usernames or emails', async () => {
  store.user.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  }));
  const response = await request(app).post('/auth/signup').send({
    username: user.username,
    email: user.email,
    password,
  });

  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe('ACCOUNT_CONFLICT');
});

it('rejects passwords bcrypt would truncate', async () => {
  const response = await request(app).post('/auth/signup').send({
    username: user.username,
    email: user.email,
    password: 'é'.repeat(37),
  });

  expect(response.status).toBe(400);
  expect(store.user.create).not.toHaveBeenCalled();
});

it('rejects an incorrect password without creating a session', async () => {
  store.user.findUnique.mockResolvedValueOnce({ id: user.id, passwordHash });
  const response = await request(app).post('/auth/login').send({
    email: user.email,
    password: 'wrong-password',
  });

  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  expect(store.refreshSession.create).not.toHaveBeenCalled();
  expect(response.headers['set-cookie']).toBeUndefined();
});

it('issues both token lifetimes, stores only the hashed refresh identifier, and authorizes the profile', async () => {
  store.user.findUnique.mockResolvedValueOnce({ id: user.id, passwordHash }).mockResolvedValueOnce(user);
  const response = await request(app).post('/auth/login').send({ email: user.email, password });

  expect(response.status).toBe(200);
  expect(Object.keys(response.body)).toEqual(['accessToken']);
  const access = jwt.verify(response.body.accessToken, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  expect(access).toMatchObject({ sub: user.id, tokenUse: 'access' });
  expect(access.exp! - access.iat!).toBe(900);

  const [cookie] = response.headers['set-cookie'] as unknown as string[];
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/auth', 'Max-Age=604800']) {
    expect(cookie).toContain(attribute);
  }
  const refreshToken = decodeURIComponent(cookie.slice('refreshToken='.length).split(';')[0]);
  const refresh = jwt.verify(refreshToken, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  expect(refresh).toMatchObject({ sub: user.id, tokenUse: 'refresh' });
  expect(refresh.exp! - refresh.iat!).toBe(604800);
  expect(store.refreshSession.create).toHaveBeenCalledWith({
    data: {
      userId: user.id,
      tokenHash: createHash('sha256').update(refresh.jti!).digest('hex'),
      expiresAt: new Date(refresh.exp! * 1000),
    },
  });

  const profile = await request(app).get('/users/me').set('Authorization', `Bearer ${response.body.accessToken}`);
  expect(profile.status).toBe(200);
  expect(profile.body).toEqual({ user });
  const rejectedRefresh = await request(app).get('/users/me').set('Authorization', `Bearer ${refreshToken}`);
  expect(rejectedRefresh.status).toBe(401);
});

it('rejects missing and expired access tokens before looking up the user', async () => {
  const expired = jwt.sign({ tokenUse: 'access' }, secret, {
    algorithm: 'HS256', subject: user.id, expiresIn: -1,
  });
  expect((await request(app).get('/users/me')).status).toBe(401);
  expect((await request(app).get('/users/me').set('Authorization', `Bearer ${expired}`)).status).toBe(401);
  expect(store.user.findUnique).not.toHaveBeenCalled();
});

function refreshCookie(expiresIn = 3600): string {
  const token = jwt.sign({ tokenUse: 'refresh' }, secret, {
    algorithm: 'HS256',
    subject: user.id,
    jwtid: '526ee6ef-171d-4273-a8b6-22d1f32db785',
    expiresIn,
  });
  return `refreshToken=${token}`;
}

it.each(['/auth/refresh', '/auth/logout'])('rejects missing and untrusted origins for %s', async path => {
  const missing = await request(app).post(path).set('Cookie', refreshCookie());
  const invalid = await request(app).post(path).set('Cookie', refreshCookie()).set('Origin', trustedOrigin + '.evil.invalid');

  expect(missing.status).toBe(403);
  expect(invalid.status).toBe(403);
  expect(invalid.headers['access-control-allow-origin']).toBeUndefined();
  expect(store.$transaction).not.toHaveBeenCalled();
  expect(store.refreshSession.updateMany).not.toHaveBeenCalled();
});

it('permits credentialed CORS only for configured browser origins', async () => {
  const allowed = await request(app).options('/auth/refresh')
    .set('Origin', trustedOrigin)
    .set('Access-Control-Request-Method', 'POST');
  const denied = await request(app).options('/auth/refresh')
    .set('Origin', 'https://untrusted.example.invalid')
    .set('Access-Control-Request-Method', 'POST');

  expect(allowed.status).toBe(204);
  expect(allowed.headers['access-control-allow-origin']).toBe(trustedOrigin);
  expect(allowed.headers['access-control-allow-credentials']).toBe('true');
  expect(denied.headers['access-control-allow-origin']).toBeUndefined();
});

it('rotates a claimed session and rejects the same cookie on replay', async () => {
  store.refreshSession.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
  const current = refreshCookie();
  const rotate = () => request(app).post('/auth/refresh').set('Origin', trustedOrigin).set('Cookie', current);
  const response = await rotate();
  const replay = await rotate();

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ accessToken: expect.any(String) });
  expect(response.headers['set-cookie'][0].split(';')[0]).not.toBe(current);
  expect(replay.status).toBe(401);
  expect(replay.headers['set-cookie']).toBeUndefined();
  expect(store.$transaction).toHaveBeenCalledTimes(2);
  expect(store.refreshSession.create).toHaveBeenCalledTimes(1);
  expect(store.refreshSession.updateMany).toHaveBeenCalledWith({
    where: {
      userId: user.id,
      tokenHash: createHash('sha256').update('526ee6ef-171d-4273-a8b6-22d1f32db785').digest('hex'),
      revokedAt: null,
      expiresAt: { gt: expect.any(Date) },
    },
    data: { revokedAt: expect.any(Date) },
  });
});

it('rejects missing and expired refresh cookies before looking up the session', async () => {
  const missing = await request(app).post('/auth/refresh').set('Origin', trustedOrigin);
  const expired = await request(app).post('/auth/refresh').set('Origin', trustedOrigin).set('Cookie', refreshCookie(-1));
  expect(missing.status).toBe(401);
  expect(expired.status).toBe(401);
  expect(store.$transaction).not.toHaveBeenCalled();
});

it('revokes the session and clears the same cross-site gateway cookie on logout', async () => {
  process.env.AUTH_REFRESH_COOKIE_PATH = '/api/auth';
  process.env.AUTH_REFRESH_COOKIE_SAME_SITE = 'none';
  store.refreshSession.updateMany.mockResolvedValueOnce({ count: 1 });
  const response = await request(app).post('/auth/logout').set('Origin', trustedOrigin).set('Cookie', refreshCookie());

  expect(response.status).toBe(204);
  expect(store.refreshSession.updateMany).toHaveBeenCalledTimes(1);
  const [cookie] = response.headers['set-cookie'] as unknown as string[];
  for (const attribute of ['refreshToken=;', 'Secure', 'HttpOnly', 'Path=/api/auth', 'SameSite=None', 'Expires=Thu, 01 Jan 1970']) {
    expect(cookie).toContain(attribute);
  }
});

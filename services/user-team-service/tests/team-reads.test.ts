import jwt from 'jsonwebtoken';
import request from 'supertest';

import { app } from '../src/app';
import { getDatabase } from '../src/database';

jest.mock('../src/database', () => ({ getDatabase: jest.fn() }));

const secret = 'teamisty-team-reads-test-secret-not-for-runtime';
const userId = '49374d77-4185-4b60-9f97-7d68c60f5b21';
const teamId = 'ad32219e-45c2-43cd-9c6f-c5fec89b7811';
const otherTeamId = '7b90a512-0765-437a-b768-2a0d3100d505';
const team = { id: teamId, name: 'DevOps Team', boardProvisioningStatus: 'PENDING' };
const tx = {
  user: { findUnique: jest.fn() },
  team: { findFirst: jest.fn() },
  membership: { findFirst: jest.fn(), findMany: jest.fn() },
};
const db = { $transaction: jest.fn() };
const originalSecret = process.env.JWT_SECRET;

beforeEach(() => {
  jest.resetAllMocks();
  process.env.JWT_SECRET = secret;
  jest.mocked(getDatabase).mockReturnValue(db as unknown as ReturnType<typeof getDatabase>);
  db.$transaction.mockImplementation(async operation => operation(tx));
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

function get(path: string) {
  const token = jwt.sign({ tokenUse: 'access' }, secret, {
    algorithm: 'HS256', subject: userId, expiresIn: 900,
  });
  return request(app).get(path).set('Authorization', `Bearer ${token}`);
}

it('lists the caller’s active memberships with separate roles and bounded pagination', async () => {
  tx.user.findUnique.mockResolvedValue({ id: userId });
  tx.membership.findMany.mockResolvedValue([
    { team, role: 'OWNER' },
    { team: { ...team, id: otherTeamId }, role: 'MEMBER' },
    { team: { ...team, id: 'extra-team' }, role: 'LEADER' },
  ]);

  const response = await get('/users/me/teams?page=2&limit=2');

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    items: [{ team, role: 'OWNER' }, { team: { ...team, id: otherTeamId }, role: 'MEMBER' }],
    page: 2, limit: 2, hasMore: true,
  });
  expect(tx.membership.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { userId, removedAt: null, team: { deletedAt: null } },
    skip: 2, take: 3,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  }));
});

it('returns an empty first page for a user without active teams', async () => {
  tx.user.findUnique.mockResolvedValue({ id: userId });
  tx.membership.findMany.mockResolvedValue([]);
  const response = await get('/users/me/teams');
  expect(response.body).toEqual({ items: [], page: 1, limit: 20, hasMore: false });
});

it('returns the requested team with the caller’s role', async () => {
  tx.team.findFirst.mockResolvedValue(team);
  tx.membership.findFirst.mockResolvedValue({ role: 'LEADER' });
  const response = await get(`/teams/${teamId}`);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ team, role: 'LEADER' });
});

it('lists only active members of the requested team with public profile fields', async () => {
  tx.team.findFirst.mockResolvedValue(team);
  tx.membership.findFirst.mockResolvedValue({ role: 'MEMBER' });
  tx.membership.findMany.mockResolvedValue([
    { userId, role: 'MEMBER', user: { username: 'alice', displayName: null } },
  ]);

  const response = await get(`/teams/${teamId}/members`);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    items: [{ userId, role: 'MEMBER', username: 'alice', displayName: null }],
    page: 1, limit: 20, hasMore: false,
  });
  expect(tx.membership.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { teamId, removedAt: null },
    select: { userId: true, role: true, user: { select: { username: true, displayName: true } } },
  }));
});

it.each(['', '/members'])('denies team access without an active membership (%s)', async suffix => {
  tx.team.findFirst.mockResolvedValue(team);
  tx.membership.findFirst.mockResolvedValue(null);
  const response = await get(`/teams/${teamId}${suffix}`);
  expect(response.status).toBe(403);
  expect(tx.membership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { teamId, userId, removedAt: null },
  }));
  expect(tx.membership.findMany).not.toHaveBeenCalled();
});

it.each(['', '/members'])('hides deleted or missing teams (%s)', async suffix => {
  tx.team.findFirst.mockResolvedValue(null);
  const response = await get(`/teams/${teamId}${suffix}`);
  expect(response.status).toBe(404);
  expect(tx.team.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: teamId, deletedAt: null },
  }));
  expect(tx.membership.findFirst).not.toHaveBeenCalled();
});

it('rejects invalid pagination, malformed team IDs, and missing authentication', async () => {
  expect((await get('/users/me/teams?limit=101')).status).toBe(400);
  expect((await get('/users/me/teams?page=1&page=2')).status).toBe(400);
  expect((await get('/teams/not-a-uuid')).status).toBe(400);
  expect((await request(app).get('/users/me/teams')).status).toBe(401);
  expect(db.$transaction).not.toHaveBeenCalled();
});

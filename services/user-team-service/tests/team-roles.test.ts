import jwt from 'jsonwebtoken';
import request from 'supertest';

import { app } from '../src/app';
import { getDatabase } from '../src/database';

jest.mock('../src/database', () => ({ getDatabase: jest.fn() }));

const secret = 'teamisty-team-roles-test-secret-not-for-runtime';
const teamId = 'ad32219e-45c2-43cd-9c6f-c5fec89b7811';
const owner = { id: 'owner-membership', userId: '49374d77-4185-4b60-9f97-7d68c60f5b21', role: 'OWNER' };
const member = { id: 'member-membership', userId: '7b90a512-0765-437a-b768-2a0d3100d505', role: 'MEMBER' };
const tx = { $queryRaw: jest.fn(), membership: { findFirst: jest.fn(), update: jest.fn() } };
const db = { $transaction: jest.fn() };
const originalSecret = process.env.JWT_SECRET;

beforeEach(() => {
  jest.resetAllMocks();
  process.env.JWT_SECRET = secret;
  jest.mocked(getDatabase).mockReturnValue(db as unknown as ReturnType<typeof getDatabase>);
  db.$transaction.mockImplementation(async operation => operation(tx));
  tx.$queryRaw.mockResolvedValue([{ id: teamId }]);
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

function patch(path: string, body: object, actorId = owner.userId) {
  const jwtToken = jwt.sign({ tokenUse: 'access' }, secret, {
    algorithm: 'HS256', subject: actorId, expiresIn: 900,
  });
  return request(app).patch(path).set('Authorization', `Bearer ${jwtToken}`).send(body);
}

const rolePath = (userId: string) => `/teams/${teamId}/members/${userId}/role`;
const transferPath = `/teams/${teamId}/ownership`;

it.each(['LEADER', 'MEMBER'])('rejects role changes by a %s', async role => {
  tx.membership.findFirst.mockResolvedValueOnce({ ...member, role });
  const response = await patch(rolePath(member.userId), { role: 'LEADER' }, member.userId);
  expect(response.status).toBe(403);
  expect(response.body.error.code).toBe('OWNER_REQUIRED');
  expect(tx.membership.update).not.toHaveBeenCalled();
});

it('rejects ownership transfer by the Leader', async () => {
  tx.membership.findFirst.mockResolvedValueOnce({ ...member, role: 'LEADER' });
  const response = await patch(transferPath, { newOwnerId: owner.userId }, member.userId);
  expect(response.status).toBe(403);
  expect(tx.membership.update).not.toHaveBeenCalled();
});

it.each([['LEADER', 'MEMBER'], ['MEMBER', 'LEADER']])('lets the Owner set %s on a %s', async (to, from) => {
  tx.membership.findFirst.mockResolvedValueOnce(owner).mockResolvedValueOnce({ ...member, role: from })
    .mockResolvedValueOnce(null);
  const response = await patch(rolePath(member.userId), { role: to });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ userId: member.userId, role: to });
  expect(tx.membership.update).toHaveBeenCalledWith({ where: { id: member.id }, data: { role: to } });
});

it('rejects a second active Leader', async () => {
  tx.membership.findFirst.mockResolvedValueOnce(owner).mockResolvedValueOnce(member)
    .mockResolvedValueOnce({ id: 'another-leader' });
  const response = await patch(rolePath(member.userId), { role: 'LEADER' });
  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe('LEADER_ALREADY_EXISTS');
  expect(tx.membership.update).not.toHaveBeenCalled();
});

it('protects the Owner role from direct changes', async () => {
  tx.membership.findFirst.mockResolvedValueOnce(owner).mockResolvedValueOnce(owner);
  const response = await patch(rolePath(owner.userId), { role: 'MEMBER' });
  expect(response.status).toBe(403);
  expect(tx.membership.update).not.toHaveBeenCalled();
});

it('transfers ownership by demoting the old Owner and promoting the target in one transaction', async () => {
  tx.membership.findFirst.mockResolvedValueOnce(owner).mockResolvedValueOnce({ ...member, role: 'LEADER' });
  const response = await patch(transferPath, { newOwnerId: member.userId });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ teamId, ownerId: member.userId, previousOwnerId: owner.userId });
  expect(db.$transaction).toHaveBeenCalledTimes(1);
  expect(tx.membership.update).toHaveBeenNthCalledWith(1, {
    where: { id: owner.id }, data: { role: 'MEMBER' },
  });
  expect(tx.membership.update).toHaveBeenNthCalledWith(2, {
    where: { id: member.id }, data: { role: 'OWNER' },
  });
});

it('rejects ownership transfer to a removed or missing member', async () => {
  tx.membership.findFirst.mockResolvedValueOnce(owner).mockResolvedValueOnce(null);
  const response = await patch(transferPath, { newOwnerId: member.userId });
  expect(response.status).toBe(404);
  expect(tx.membership.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
    where: { teamId, userId: member.userId, removedAt: null },
  }));
  expect(tx.membership.update).not.toHaveBeenCalled();
});

it('returns not found for a missing or deleted team before checking roles', async () => {
  tx.$queryRaw.mockResolvedValue([]);
  const response = await patch(transferPath, { newOwnerId: member.userId });
  expect(response.status).toBe(404);
  expect(tx.membership.findFirst).not.toHaveBeenCalled();
});

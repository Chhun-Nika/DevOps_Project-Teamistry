import jwt from 'jsonwebtoken';
import request from 'supertest';

import { app, createApp } from '../src/app';
import { getDatabase } from '../src/database';

jest.mock('../src/database', () => ({ getDatabase: jest.fn() }));

const secret = 'teamisty-team-deletion-test-secret-not-for-runtime';
const teamId = 'ad32219e-45c2-43cd-9c6f-c5fec89b7811';
const owner = { id: 'owner-membership', userId: '49374d77-4185-4b60-9f97-7d68c60f5b21', role: 'OWNER' };
const member = { id: 'member-membership', userId: '7b90a512-0765-437a-b768-2a0d3100d505', role: 'MEMBER' };
const leader = { id: 'leader-membership', userId: '83270f1c-c005-467f-ac95-f8107d826ef6', role: 'LEADER' };
const teamPath = `/teams/${teamId}`;
const memberPath = (userId: string) => `${teamPath}/members/${userId}`;
const tx = {
  $queryRaw: jest.fn(),
  team: { findFirst: jest.fn(), update: jest.fn() },
  membership: { findFirst: jest.fn(), update: jest.fn() },
};
const db = { $transaction: jest.fn() };
const checkActiveTasks = jest.fn();
const testApp = createApp(checkActiveTasks);
const originalSecret = process.env.JWT_SECRET;

beforeEach(() => {
  jest.resetAllMocks();
  process.env.JWT_SECRET = secret;
  jest.mocked(getDatabase).mockReturnValue(db as unknown as ReturnType<typeof getDatabase>);
  db.$transaction.mockImplementation(async operation => operation(tx));
  tx.$queryRaw.mockResolvedValue([{ id: teamId }]);
  tx.team.findFirst.mockResolvedValue({ id: teamId });
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

function remove(path: string, actorId = owner.userId, targetApp = testApp) {
  const token = jwt.sign({ tokenUse: 'access' }, secret, {
    algorithm: 'HS256', subject: actorId, expiresIn: 900,
  });
  return request(targetApp).delete(path).set('Authorization', `Bearer ${token}`);
}

it('soft-deletes the team for its active Owner without changing memberships', async () => {
  tx.membership.findFirst.mockResolvedValueOnce(owner);
  expect((await remove(teamPath)).status).toBe(204);
  expect(tx.team.update).toHaveBeenCalledWith({
    where: { id: teamId }, data: { deletedAt: expect.any(Date) },
  });
  expect(tx.membership.update).not.toHaveBeenCalled();
});

it('rejects team deletion by the Leader', async () => {
  tx.membership.findFirst.mockResolvedValueOnce(leader);
  expect((await remove(teamPath, leader.userId)).status).toBe(403);
  expect(tx.team.update).not.toHaveBeenCalled();
});

it.each([[owner, member], [leader, member], [owner, leader]])(
  'soft-removes an authorized target after a zero-count check',
  async (actor, target) => {
    tx.membership.findFirst.mockResolvedValueOnce(actor).mockResolvedValueOnce(target)
      .mockResolvedValueOnce(actor).mockResolvedValueOnce(target);
    checkActiveTasks.mockResolvedValue(0);
    expect((await remove(memberPath(target.userId), actor.userId)).status).toBe(204);
    expect(checkActiveTasks).toHaveBeenCalledWith(teamId, target.userId);
    expect(tx.membership.update).toHaveBeenCalledWith({
      where: { id: target.id }, data: { removedAt: expect.any(Date) },
    });
  },
);

it.each([[leader, owner], [leader, leader], [member, leader]])(
  'denies an unauthorized removal before calling Task Service',
  async (actor, target) => {
    tx.membership.findFirst.mockResolvedValueOnce(actor).mockResolvedValueOnce(target);
    expect((await remove(memberPath(target.userId), actor.userId)).status).toBe(403);
    expect(checkActiveTasks).not.toHaveBeenCalled();
    expect(tx.membership.update).not.toHaveBeenCalled();
  },
);

it('preserves the membership when assignments remain', async () => {
  tx.membership.findFirst.mockResolvedValueOnce(owner).mockResolvedValueOnce(member);
  checkActiveTasks.mockResolvedValue(2);
  const response = await remove(memberPath(member.userId));
  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe('MEMBER_HAS_ACTIVE_TASKS');
  expect(tx.membership.update).not.toHaveBeenCalled();
});

it('preserves the membership when the Task Service check fails or is unwired', async () => {
  tx.membership.findFirst.mockResolvedValueOnce(owner).mockResolvedValueOnce(member)
    .mockResolvedValueOnce(owner).mockResolvedValueOnce(member);
  checkActiveTasks.mockRejectedValue(new Error('simulated timeout'));
  const failed = await remove(memberPath(member.userId));
  const unwired = await remove(memberPath(member.userId), owner.userId, app);
  expect(failed.status).toBe(503);
  expect(failed.body.error.code).toBe('TASK_CHECK_UNAVAILABLE');
  expect(unwired.status).toBe(503);
  expect(tx.membership.update).not.toHaveBeenCalled();
});

it('does not remove a replacement membership after a member rejoins during the check', async () => {
  tx.membership.findFirst.mockResolvedValueOnce(owner).mockResolvedValueOnce(member)
    .mockResolvedValueOnce(owner).mockResolvedValueOnce({ ...member, id: 'rejoined-membership' });
  checkActiveTasks.mockResolvedValue(0);
  const response = await remove(memberPath(member.userId));
  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe('MEMBERSHIP_CHANGED');
  expect(tx.membership.update).not.toHaveBeenCalled();
});

it('rechecks the actor’s authority after the task check', async () => {
  tx.membership.findFirst.mockResolvedValueOnce(owner).mockResolvedValueOnce(member)
    .mockResolvedValueOnce({ ...owner, role: 'MEMBER' });
  checkActiveTasks.mockResolvedValue(0);
  expect((await remove(memberPath(member.userId))).status).toBe(403);
  expect(tx.membership.update).not.toHaveBeenCalled();
});

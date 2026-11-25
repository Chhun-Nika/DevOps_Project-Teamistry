import jwt from 'jsonwebtoken';
import request from 'supertest';

import { app } from '../src/app';
import { getDatabase } from '../src/database';

jest.mock('../src/database', () => ({ getDatabase: jest.fn() }));

const secret = 'teamisty-invitation-test-secret-not-for-runtime';
const teamId = 'ad32219e-45c2-43cd-9c6f-c5fec89b7811';
const inviterId = '49374d77-4185-4b60-9f97-7d68c60f5b21';
const inviteeId = '7b90a512-0765-437a-b768-2a0d3100d505';
const invitation = {
  id: '83270f1c-c005-467f-ac95-f8107d826ef6', teamId, inviterId, inviteeId,
  status: 'PENDING', createdAt: '2026-11-25T00:00:00Z', respondedAt: null,
};
const path = `/teams/${teamId}/invitations`;
const tx = {
  $queryRaw: jest.fn(),
  user: { findUnique: jest.fn() },
  membership: { findFirst: jest.fn() },
  invitation: { findFirst: jest.fn(), create: jest.fn() },
  outboxEvent: { create: jest.fn() },
};
const db = { $transaction: jest.fn() };
const originalSecret = process.env.JWT_SECRET;

beforeEach(() => {
  jest.resetAllMocks();
  process.env.JWT_SECRET = secret;
  jest.mocked(getDatabase).mockReturnValue(db as unknown as ReturnType<typeof getDatabase>);
  db.$transaction.mockImplementation(async operation => operation(tx));
  tx.$queryRaw.mockResolvedValue([{ id: teamId }]);
  tx.user.findUnique.mockResolvedValue({ id: inviteeId });
  tx.invitation.findFirst.mockResolvedValue(null);
  tx.invitation.create.mockResolvedValue(invitation);
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

function invite(body: object) {
  const token = jwt.sign({ tokenUse: 'access' }, secret, {
    algorithm: 'HS256', subject: inviterId, expiresIn: 900,
  });
  return request(app).post(path).set('Authorization', `Bearer ${token}`).send(body);
}

it.each([
  ['OWNER', { username: '  alice  ' }, { username: 'alice' }],
  ['LEADER', { email: ' ALICE@example.invalid ' }, { email: 'alice@example.invalid' }],
])('lets an active %s invite by one normalized lookup', async (role, input, lookup) => {
  tx.membership.findFirst.mockResolvedValueOnce({ role }).mockResolvedValueOnce(null);
  const result = await invite(input);

  expect(result.status).toBe(201);
  expect(result.body).toEqual({ invitation });
  expect(db.$transaction).toHaveBeenCalledTimes(1);
  expect(tx.user.findUnique).toHaveBeenCalledWith({ where: lookup, select: { id: true } });
  expect(tx.invitation.create).toHaveBeenCalledWith(expect.objectContaining({
    data: { teamId, inviterId, inviteeId, status: 'PENDING' },
  }));
  expect(tx.outboxEvent.create).toHaveBeenCalledWith({
    data: {
      teamId, correlationId: expect.any(String), eventType: 'INVITATION_CREATED', status: 'PENDING',
      data: {
        invitationId: invitation.id, teamId, recipientId: inviteeId,
        actorId: inviterId, message: expect.any(String),
      },
    },
  });
});

it('requires bearer auth and exactly one lookup field', async () => {
  expect((await request(app).post(path).send({ username: 'alice' })).status).toBe(401);
  expect((await invite({ username: 'alice', email: 'alice@example.invalid' })).status).toBe(400);
  expect(db.$transaction).not.toHaveBeenCalled();
});

it.each(['MEMBER', null])('denies a caller without an active inviter role (%s)', async role => {
  tx.membership.findFirst.mockResolvedValueOnce(role ? { role } : null);
  expect((await invite({ username: 'alice' })).status).toBe(403);
  expect(tx.user.findUnique).not.toHaveBeenCalled();
});

it('hides deleted or missing teams and rejects unknown registered users', async () => {
  tx.$queryRaw.mockResolvedValueOnce([]);
  const missingTeam = await invite({ username: 'alice' });
  tx.membership.findFirst.mockResolvedValueOnce({ role: 'OWNER' });
  tx.user.findUnique.mockResolvedValueOnce(null);
  const missingUser = await invite({ username: 'alice' });
  expect(missingTeam.body.error.code).toBe('TEAM_NOT_FOUND');
  expect(missingUser.body.error.code).toBe('INVITEE_NOT_FOUND');
  expect(tx.invitation.create).not.toHaveBeenCalled();
});

it('rejects active members and duplicate pending invitations without enqueueing an event', async () => {
  tx.membership.findFirst.mockResolvedValueOnce({ role: 'OWNER' }).mockResolvedValueOnce({ role: 'MEMBER' })
    .mockResolvedValueOnce({ role: 'OWNER' }).mockResolvedValueOnce(null);
  tx.invitation.findFirst.mockResolvedValueOnce({ id: invitation.id });

  const activeMember = await invite({ username: 'alice' });
  const duplicate = await invite({ username: 'alice' });
  expect(activeMember.status).toBe(409);
  expect(activeMember.body.error.code).toBe('ALREADY_TEAM_MEMBER');
  expect(duplicate.status).toBe(409);
  expect(duplicate.body.error.code).toBe('INVITATION_ALREADY_PENDING');
  expect(tx.invitation.create).not.toHaveBeenCalled();
  expect(tx.outboxEvent.create).not.toHaveBeenCalled();
});

it('does not return success when the outbox insert fails', async () => {
  tx.membership.findFirst.mockResolvedValueOnce({ role: 'OWNER' }).mockResolvedValueOnce(null);
  tx.outboxEvent.create.mockRejectedValueOnce(new Error('injected outbox failure'));
  expect((await invite({ username: 'alice' })).status).toBe(500);
});

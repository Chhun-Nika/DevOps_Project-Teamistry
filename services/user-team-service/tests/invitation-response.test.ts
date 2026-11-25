import jwt from 'jsonwebtoken';
import request from 'supertest';

import { app } from '../src/app';
import { getDatabase } from '../src/database';

jest.mock('../src/database', () => ({ getDatabase: jest.fn() }));

const secret = 'teamisty-invitation-response-test-not-for-runtime';
const inviteeId = '7b90a512-0765-437a-b768-2a0d3100d505';
const teamId = 'ad32219e-45c2-43cd-9c6f-c5fec89b7811';
const id = '83270f1c-c005-467f-ac95-f8107d826ef6';
const path = `/invitations/${id}`;
const tx = {
  $queryRaw: jest.fn(),
  invitation: { findFirst: jest.fn(), update: jest.fn() },
  membership: { findFirst: jest.fn(), create: jest.fn() },
};
const db = { $transaction: jest.fn() };
const originalSecret = process.env.JWT_SECRET;

beforeEach(() => {
  jest.resetAllMocks();
  process.env.JWT_SECRET = secret;
  jest.mocked(getDatabase).mockReturnValue(db as unknown as ReturnType<typeof getDatabase>);
  db.$transaction.mockImplementation(async operation => operation(tx));
  tx.invitation.findFirst.mockResolvedValueOnce({ teamId }).mockResolvedValueOnce({ status: 'PENDING' });
  tx.$queryRaw.mockResolvedValue([{ id: teamId }]);
  tx.membership.findFirst.mockResolvedValue(null);
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

function respond(body: object, endpoint = path) {
  const token = jwt.sign({ tokenUse: 'access' }, secret, {
    algorithm: 'HS256', subject: inviteeId, expiresIn: 900,
  });
  return request(app).patch(endpoint).set('Authorization', `Bearer ${token}`).send(body);
}

it.each(['ACCEPTED', 'DECLINED'])('records a response of %s in one transaction', async status => {
  const invitation = { id, teamId, inviteeId, status, respondedAt: '2026-11-25T00:00:00Z' };
  tx.invitation.update.mockResolvedValue(invitation);
  const response = await respond({ status });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ invitation });
  expect(db.$transaction).toHaveBeenCalledTimes(1);
  expect(tx.invitation.findFirst).toHaveBeenNthCalledWith(2, {
    where: { id, teamId, inviteeId }, select: { status: true },
  });
  expect(tx.invitation.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id }, data: { status, respondedAt: expect.any(Date) },
  }));
  if (status === 'ACCEPTED') {
    expect(tx.membership.create).toHaveBeenCalledWith({ data: { teamId, userId: inviteeId, role: 'MEMBER' } });
  } else {
    expect(tx.membership.create).not.toHaveBeenCalled();
  }
});

it('does not reveal invitations belonging to another user', async () => {
  tx.invitation.findFirst.mockReset().mockResolvedValueOnce(null);
  const response = await respond({ status: 'ACCEPTED' });
  expect(response.status).toBe(404);
  expect(response.body.error.code).toBe('INVITATION_NOT_FOUND');
  expect(tx.invitation.findFirst).toHaveBeenCalledWith({ where: { id, inviteeId }, select: { teamId: true } });
  expect(tx.$queryRaw).not.toHaveBeenCalled();
  expect(tx.membership.create).not.toHaveBeenCalled();
});

it('rejects responses to a deleted team', async () => {
  tx.$queryRaw.mockResolvedValue([]);
  expect((await respond({ status: 'DECLINED' })).status).toBe(404);
  expect(tx.invitation.update).not.toHaveBeenCalled();
});

it.each(['ACCEPTED', 'DECLINED', 'CANCELLED'])('rejects repeat responses when the invitation is %s', async status => {
  tx.invitation.findFirst.mockReset().mockResolvedValueOnce({ teamId }).mockResolvedValueOnce({ status });
  const response = await respond({ status: 'ACCEPTED' });
  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe('INVITATION_NOT_PENDING');
  expect(tx.membership.create).not.toHaveBeenCalled();
  expect(tx.invitation.update).not.toHaveBeenCalled();
});

it('rejects acceptance if the invitee is already an active member', async () => {
  tx.membership.findFirst.mockResolvedValueOnce({ id: 'existing-member' });
  const response = await respond({ status: 'ACCEPTED' });
  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe('ALREADY_TEAM_MEMBER');
  expect(tx.membership.create).not.toHaveBeenCalled();
  expect(tx.invitation.update).not.toHaveBeenCalled();
});

it('rejects unauthenticated requests and invalid IDs or input', async () => {
  expect((await request(app).patch(path).send({ status: 'ACCEPTED' })).status).toBe(401);
  expect((await respond({ status: 'CANCELLED' })).status).toBe(400);
  expect((await respond({ status: 'ACCEPTED' }, '/invitations/invalid')).status).toBe(400);
  expect(db.$transaction).not.toHaveBeenCalled();
});

import jwt from 'jsonwebtoken';
import request from 'supertest';

import { app } from '../src/app';
import { getDatabase } from '../src/database';

jest.mock('../src/database', () => ({ getDatabase: jest.fn() }));

const secret = 'teamisty-invitation-list-test-secret-not-for-runtime';
const inviteeId = '7b90a512-0765-437a-b768-2a0d3100d505';
const tx = { user: { findUnique: jest.fn() }, invitation: { findMany: jest.fn() } };
const db = { $transaction: jest.fn() };
const originalSecret = process.env.JWT_SECRET;
const item = {
  id: '83270f1c-c005-467f-ac95-f8107d826ef6',
  teamId: 'ad32219e-45c2-43cd-9c6f-c5fec89b7811',
  inviterId: '49374d77-4185-4b60-9f97-7d68c60f5b21',
  inviteeId,
  status: 'PENDING',
  createdAt: '2026-11-25T00:00:00Z',
  respondedAt: null,
  team: { id: 'ad32219e-45c2-43cd-9c6f-c5fec89b7811', name: 'Teamisty' },
  inviter: { id: '49374d77-4185-4b60-9f97-7d68c60f5b21', username: 'owner', displayName: null },
};

beforeEach(() => {
  jest.resetAllMocks();
  process.env.JWT_SECRET = secret;
  jest.mocked(getDatabase).mockReturnValue(db as unknown as ReturnType<typeof getDatabase>);
  db.$transaction.mockImplementation(async operation => operation(tx));
  tx.user.findUnique.mockResolvedValue({ id: inviteeId });
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

function list(query = '') {
  const token = jwt.sign({ tokenUse: 'access' }, secret, {
    algorithm: 'HS256', subject: inviteeId, expiresIn: 900,
  });
  return request(app).get('/invitations' + query).set('Authorization', `Bearer ${token}`);
}

it('lists only the bearer subject’s invitations from active teams with bounded pagination', async () => {
  tx.invitation.findMany.mockResolvedValue([item, { ...item, id: 'sentinel' }]);
  const response = await list('?page=2&limit=1&inviteeId=other-user');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ items: [item], page: 2, limit: 1, hasMore: true });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(tx.invitation.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { inviteeId, team: { deletedAt: null } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: 1,
    take: 2,
    select: expect.objectContaining({
      inviter: { select: { id: true, username: true, displayName: true } },
    }),
  }));
});

it('returns an empty page with defaults', async () => {
  tx.invitation.findMany.mockResolvedValue([]);
  const response = await list();
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ items: [], page: 1, limit: 20, hasMore: false });
});

it('rejects missing authentication or invalid pagination without querying invitations', async () => {
  expect((await request(app).get('/invitations')).status).toBe(401);
  expect((await list('?limit=101')).status).toBe(400);
  expect(db.$transaction).not.toHaveBeenCalled();
});

it('rejects a token whose account no longer exists', async () => {
  tx.user.findUnique.mockResolvedValueOnce(null);
  expect((await list()).status).toBe(401);
  expect(tx.invitation.findMany).not.toHaveBeenCalled();
});

import jwt from 'jsonwebtoken';
import request from 'supertest';

import { app } from '../src/app';
import { getDatabase } from '../src/database';

jest.mock('../src/database', () => ({ getDatabase: jest.fn() }));

const secret = 'teamisty-team-creation-test-secret-not-for-runtime';
const creatorId = '49374d77-4185-4b60-9f97-7d68c60f5b21';
const team = {
  id: 'ad32219e-45c2-43cd-9c6f-c5fec89b7811',
  name: 'DevOps Team',
  boardProvisioningStatus: 'PENDING',
};
const tx = {
  user: { findUnique: jest.fn() },
  team: { create: jest.fn() },
  membership: { create: jest.fn() },
  outboxEvent: { create: jest.fn() },
};
const db = { $transaction: jest.fn() };
const originalSecret = process.env.JWT_SECRET;

beforeEach(() => {
  jest.resetAllMocks();
  process.env.JWT_SECRET = secret;
  jest.mocked(getDatabase).mockReturnValue(db as unknown as ReturnType<typeof getDatabase>);
  db.$transaction.mockImplementation(async operation => operation(tx));
  tx.user.findUnique.mockResolvedValue({ id: creatorId });
  tx.team.create.mockResolvedValue(team);
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

function bearer(expiresIn = 900): string {
  return 'Bearer ' + jwt.sign({ tokenUse: 'access' }, secret, {
    algorithm: 'HS256',
    subject: creatorId,
    expiresIn,
  });
}

it('requires a valid access JWT before using the database', async () => {
  const create = () => request(app).post('/teams').send({ name: team.name });
  expect((await create()).status).toBe(401);
  expect((await create().set('Authorization', bearer(-1))).status).toBe(401);
  expect(db.$transaction).not.toHaveBeenCalled();
});

it.each([{ name: ' ' }, { name: 'a'.repeat(101) }, { name: team.name, creatorId }])(
  'rejects invalid team input',
  async body => {
    const response = await request(app).post('/teams').set('Authorization', bearer()).send(body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INPUT');
    expect(db.$transaction).not.toHaveBeenCalled();
  },
);

it('creates the team, its Owner, and the pending outbox event in one transaction', async () => {
  const response = await request(app).post('/teams').set('Authorization', bearer())
    .send({ name: '  DevOps Team  ' });

  expect(response.status).toBe(201);
  expect(response.body).toEqual({ team, role: 'OWNER' });
  expect(db.$transaction).toHaveBeenCalledTimes(1);
  expect(tx.team.create).toHaveBeenCalledWith(expect.objectContaining({
    data: { name: team.name, creatorId, boardProvisioningStatus: 'PENDING' },
  }));
  expect(tx.membership.create).toHaveBeenCalledWith({
    data: { teamId: team.id, userId: creatorId, role: 'OWNER' },
  });
  expect(tx.outboxEvent.create).toHaveBeenCalledWith({
    data: {
      teamId: team.id,
      correlationId: expect.any(String),
      eventType: 'TEAM_CREATED',
      status: 'PENDING',
      data: { teamId: team.id },
    },
  });
});

it('does not create a team for a token whose user is absent', async () => {
  tx.user.findUnique.mockResolvedValueOnce(null);
  const response = await request(app).post('/teams').set('Authorization', bearer()).send({ name: team.name });

  expect(response.status).toBe(401);
  expect(tx.team.create).not.toHaveBeenCalled();
});

it('returns a generic error when the transaction fails to write the outbox record', async () => {
  tx.outboxEvent.create.mockRejectedValueOnce(new Error('database details'));
  const response = await request(app).post('/teams').set('Authorization', bearer()).send({ name: team.name });

  expect(response.status).toBe(500);
  expect(response.body.error).toEqual({
    code: 'INTERNAL_ERROR',
    message: 'The request could not be completed.',
  });
});

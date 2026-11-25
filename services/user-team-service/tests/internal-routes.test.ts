import request from 'supertest';
import { createApp } from '../src/app';
import { getDatabase } from '../src/database';

jest.mock('../src/database', () => ({ getDatabase: jest.fn() }));

const teamId = '123e4567-e89b-12d3-a456-426614174000';
const userId = '123e4567-e89b-12d3-a456-426614174001';
const database = { membership: { findFirst: jest.fn() } };

describe('User & Team internal membership route', () => {
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'internal-test-token';
    jest.mocked(getDatabase).mockReturnValue(database as unknown as ReturnType<typeof getDatabase>);
    database.membership.findFirst.mockReset();
  });

  it('rejects callers without the service token', async () => {
    const response = await request(createApp()).get(`/internal/teams/${teamId}/members/${userId}`);
    expect(response.status).toBe(401);
    expect(database.membership.findFirst).not.toHaveBeenCalled();
  });

  it('returns active membership and role to an authenticated service', async () => {
    database.membership.findFirst.mockResolvedValue({ userId, teamId, role: 'MEMBER' });
    const response = await request(createApp())
      .get(`/internal/teams/${teamId}/members/${userId}`)
      .set('X-Service-Token', 'internal-test-token');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId, teamId, role: 'MEMBER', isActiveMember: true });
  });
});

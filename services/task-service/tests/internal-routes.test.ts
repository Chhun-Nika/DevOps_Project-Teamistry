import request from 'supertest';
import { createApp } from '../src/app';
import type { PrismaClient } from '../src/generated/prisma/client';

describe('Task internal active-task summary', () => {
  const database = {
    task: {
      count: jest.fn().mockResolvedValue(2)
    }
  };

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'internal-test-token';
    database.task.count.mockClear();
  });

  it('rejects requests without the service token', async () => {
    const response = await request(createApp(undefined, database as unknown as PrismaClient)).get('/internal/teams/123e4567-e89b-12d3-a456-426614174000/members/123e4567-e89b-12d3-a456-426614174001/active-task-summary');
    expect(response.status).toBe(401);
    expect(database.task.count).not.toHaveBeenCalled();
  });

  it('returns the active assignment count to an authenticated service', async () => {
    const response = await request(createApp(undefined, database as unknown as PrismaClient))
      .get('/internal/teams/123e4567-e89b-12d3-a456-426614174000/members/123e4567-e89b-12d3-a456-426614174001/active-task-summary')
      .set('X-Service-Token', 'internal-test-token');
    expect(response.status).toBe(200);
    expect(response.body.activeTaskCount).toBe(2);
    expect(database.task.count).toHaveBeenCalled();
  });
});

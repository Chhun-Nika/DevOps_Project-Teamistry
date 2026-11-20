import request from 'supertest';
import { createApp } from '../src/app';
import { TaskLifecycleService } from '../src/task-lifecycle';

describe('Task API boundary', () => {
  it('passes the authenticated actor to the lifecycle service when creating a task', async () => {
    const lifecycle = {
      create: jest.fn().mockResolvedValue({ id: 'task-1', title: 'Review' })
    } as unknown as TaskLifecycleService;

    const response = await request(createApp(lifecycle))
      .post('/teams/team-1/tasks')
      .set('x-user-id', 'member-1')
      .send({ title: 'Review' });

    expect(response.status).toBe(201);
    expect(lifecycle.create).toHaveBeenCalledWith('member-1', 'team-1', {
      title: 'Review'
    });
  });

  it('rejects invalid task input before calling the lifecycle service', async () => {
    const lifecycle = { create: jest.fn() } as unknown as TaskLifecycleService;

    const response = await request(createApp(lifecycle))
      .post('/teams/team-1/tasks')
      .set('x-user-id', 'member-1')
      .send({ title: '' });

    expect(response.status).toBe(400);
    expect(lifecycle.create).not.toHaveBeenCalled();
  });
});

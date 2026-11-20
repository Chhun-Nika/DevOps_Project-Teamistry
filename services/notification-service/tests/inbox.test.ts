import request from 'supertest';
import { createApp } from '../src/app';
import { NotificationInboxService, type Notification, type NotificationEvent, type NotificationStore } from '../src/inbox';

class MemoryNotificationStore implements NotificationStore {
  readonly records: Notification[] = [];
  private sequence = 0;

  async createIfAbsent(event: NotificationEvent): Promise<Notification> {
    const existing = this.records.find((record) => record.sourceEventId === event.sourceEventId && record.recipientId === event.recipientId);
    if (existing) return existing;
    const now = new Date();
    const record: Notification = { ...event, id: `notification-${++this.sequence}`, readAt: null, createdAt: now, updatedAt: now };
    this.records.push(record);
    return record;
  }

  async listForRecipient(recipientId: string) { return this.records.filter((record) => record.recipientId === recipientId); }
  async findForRecipient(id: string, recipientId: string) { return this.records.find((record) => record.id === id && record.recipientId === recipientId) ?? null; }
  async markRead(id: string, recipientId: string) {
    const record = this.records.find((item) => item.id === id && item.recipientId === recipientId)!;
    record.readAt = new Date();
    return record;
  }
}

const event = (recipientId: string, sourceEventId = 'event-1'): NotificationEvent => ({
  sourceEventId,
  recipientId,
  eventType: 'TASK_ASSIGNED',
  title: 'Task assigned',
  body: 'You were assigned a task.',
  payload: { taskId: 'task-1' },
  linkedTaskId: 'task-1',
  linkedTeamId: 'team-1'
});

describe('NotificationInboxService', () => {
  it('deduplicates redelivered events per recipient', async () => {
    const store = new MemoryNotificationStore();
    const inbox = new NotificationInboxService(store);

    await inbox.ingest(event('user-1'));
    await inbox.ingest(event('user-1'));
    await inbox.ingest(event('user-2'));

    expect(store.records).toHaveLength(2);
  });

  it('isolates inboxes and marks only the recipient own record as read', async () => {
    const store = new MemoryNotificationStore();
    const inbox = new NotificationInboxService(store);
    const own = await inbox.ingest(event('user-1'));
    await inbox.ingest(event('user-2', 'event-2'));

    expect(await inbox.list('user-1')).toHaveLength(1);
    await expect(inbox.markRead(own.id, 'user-2')).rejects.toThrow('Notification not found');
    await inbox.markRead(own.id, 'user-1');
    expect((await inbox.list('user-1'))[0].readAt).toBeInstanceOf(Date);
  });
});

describe('Notification inbox API', () => {
  it('lists and marks only the authenticated user notifications', async () => {
    const store = new MemoryNotificationStore();
    const inbox = new NotificationInboxService(store);
    const own = await inbox.ingest(event('user-1'));
    await inbox.ingest(event('user-2', 'event-2'));

    const app = createApp(inbox);
    const list = await request(app).get('/notifications').set('x-user-id', 'user-1');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].recipientId).toBe('user-1');

    const forbiddenRead = await request(app).patch(`/notifications/${own.id}/read`).set('x-user-id', 'user-2');
    expect(forbiddenRead.status).toBe(404);

    const read = await request(app).patch(`/notifications/${own.id}/read`).set('x-user-id', 'user-1');
    expect(read.status).toBe(200);
    expect(read.body.readAt).not.toBeNull();
  });

  it('accepts an event once and preserves linked IDs as non-owning references', async () => {
    const store = new MemoryNotificationStore();
    const app = createApp(new NotificationInboxService(store));
    const body = event('user-1');

    expect((await request(app).post('/internal/notifications/events').send(body)).status).toBe(201);
    expect((await request(app).post('/internal/notifications/events').send(body)).body.id).toBe('notification-1');
    expect(store.records[0].linkedTaskId).toBe('task-1');
  });
});

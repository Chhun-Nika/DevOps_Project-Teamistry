export type NotificationEventType = 'INVITATION_CREATED' | 'TASK_ASSIGNED' | 'TASK_REASSIGNED' | 'TASK_STATUS_UPDATED' | 'TASK_UPDATED' | 'TASK_DELETED';

export type Notification = {
  id: string;
  sourceEventId: string;
  recipientId: string;
  eventType: NotificationEventType;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  linkedTaskId: string | null;
  linkedTeamId: string | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt?: Date;
};

export type NotificationEvent = Omit<Notification, 'id' | 'readAt' | 'createdAt' | 'updatedAt'>;

export interface NotificationStore {
  createIfAbsent(event: NotificationEvent): Promise<Notification>;
  listForRecipient(recipientId: string): Promise<Notification[]>;
  findForRecipient(id: string, recipientId: string): Promise<Notification | null>;
  markRead(id: string, recipientId: string): Promise<Notification>;
}

export class NotificationNotFoundError extends Error {}

export class NotificationInboxService {
  constructor(private readonly store: NotificationStore) {}

  ingest(event: NotificationEvent): Promise<Notification> {
    return this.store.createIfAbsent(event);
  }

  list(recipientId: string): Promise<Notification[]> {
    return this.store.listForRecipient(recipientId);
  }

  async markRead(notificationId: string, recipientId: string): Promise<Notification> {
    const notification = await this.store.findForRecipient(notificationId, recipientId);
    if (!notification) throw new NotificationNotFoundError('Notification not found.');
    return this.store.markRead(notificationId, recipientId);
  }
}

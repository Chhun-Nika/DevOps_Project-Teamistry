import type { PrismaClient } from './generated/prisma/client';
import type { Notification, NotificationEvent, NotificationStore } from './inbox';

export class PrismaInboxStore implements NotificationStore {
  constructor(private readonly db: PrismaClient) {}

  async createIfAbsent(event: NotificationEvent): Promise<Notification> {
    return this.db.notification.upsert({
      where: { sourceEventId_recipientId: { sourceEventId: event.sourceEventId, recipientId: event.recipientId } },
      create: event as never,
      update: {}
    }) as Promise<Notification>;
  }

  async listForRecipient(recipientId: string): Promise<Notification[]> {
    return this.db.notification.findMany({ where: { recipientId }, orderBy: { createdAt: 'desc' } }) as Promise<Notification[]>;
  }

  async findForRecipient(id: string, recipientId: string): Promise<Notification | null> {
    return this.db.notification.findFirst({ where: { id, recipientId } }) as Promise<Notification | null>;
  }

  async markRead(id: string, recipientId: string): Promise<Notification> {
    return this.db.notification.update({ where: { id }, data: { readAt: new Date() } }) as Promise<Notification>;
  }
}

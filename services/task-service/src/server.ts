import 'dotenv/config';
import { createApp } from './app';
import type { MembershipChecker } from './membership';
import { prisma } from './prisma';
import { PrismaTaskStore } from './prisma-task-store';
import { TaskLifecycleService } from './task-lifecycle';
import { MembershipHttpClient } from './membership-http-client';
import { connectEventBus, consumeWithRetry, publishEvent } from './event-bus';
import { StatusService } from './status-service';

const port = Number(process.env.PORT ?? 3002);
const memberships: MembershipChecker = new MembershipHttpClient(
  process.env.USER_TEAM_SERVICE_URL ?? 'http://localhost:3001',
  process.env.INTERNAL_SERVICE_TOKEN ?? ''
);
const app = createApp(new TaskLifecycleService(new PrismaTaskStore(prisma), memberships), prisma);

app.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', service: 'task-service', message: `Listening on port ${port}` }));
});

void (async () => {
  const { channel } = await connectEventBus();
  const statuses = new StatusService(prisma as never);
  await consumeWithRetry(channel, 'task.events', ['TEAM_CREATED'], async event => {
    const teamId = String(event.payload.teamId ?? '');
    if (!teamId) throw new Error('TEAM_CREATED is missing teamId.');
    await statuses.initializeDefaultBoard(teamId);
    publishEvent(channel, { eventId: `${event.eventId}:board-ready`, eventType: 'TEAM_BOARD_READY', occurredAt: new Date().toISOString(), payload: { teamId } });
  });
  const publishPending = async () => {
    const events = await prisma.taskOutboxEvent.findMany({ where: { deliveryStatus: 'PENDING', availableAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: 50 });
    for (const event of events) {
      publishEvent(channel, { eventId: event.id, eventType: event.eventType, occurredAt: event.createdAt.toISOString(), payload: { ...(event.payload as Record<string, unknown>), teamId: event.teamId, taskId: event.taskId, recipientId: event.recipientId } });
      await prisma.taskOutboxEvent.update({ where: { id: event.id }, data: { deliveryStatus: 'DELIVERED', deliveredAt: new Date() } });
    }
  };
  await publishPending();
  setInterval(() => void publishPending().catch(error => console.error(JSON.stringify({ level: 'error', service: 'task-service', message: 'Outbox publish failed', error: String(error) }))), 2000);
})().catch(error => console.error(JSON.stringify({ level: 'error', service: 'task-service', message: 'RabbitMQ setup failed', error: String(error) })));

import 'dotenv/config';
import { createApp } from './app';
import { prisma } from './prisma';
import { PrismaInboxStore } from './prisma-inbox-store';
import { NotificationInboxService } from './inbox';
import { connectEventBus, consumeWithRetry } from './event-bus';

const port = Number(process.env.PORT ?? 3003);
const app = createApp(new NotificationInboxService(new PrismaInboxStore(prisma)));

app.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', service: 'notification-service', message: `Listening on port ${port}` }));
});

void (async () => {
  const { channel } = await connectEventBus();
  const inbox = new NotificationInboxService(new PrismaInboxStore(prisma));
  await consumeWithRetry(channel, 'notification.events', ['INVITATION_CREATED', 'TASK_ASSIGNED', 'TASK_REASSIGNED', 'TASK_STATUS_UPDATED', 'TASK_UPDATED', 'TASK_DELETED'], async event => {
    const recipientId = String(event.payload.recipientId ?? '');
    if (!recipientId) throw new Error('Notification event is missing recipientId.');
    await inbox.ingest({
      sourceEventId: event.eventId,
      recipientId,
      eventType: event.eventType as 'INVITATION_CREATED' | 'TASK_ASSIGNED' | 'TASK_REASSIGNED' | 'TASK_STATUS_UPDATED' | 'TASK_UPDATED' | 'TASK_DELETED',
      title: event.eventType === 'INVITATION_CREATED' ? 'Team invitation' : 'Task update',
      body: String(event.payload.message ?? `You have a new ${event.eventType.toLowerCase()} notification.`),
      payload: event.payload,
      linkedTaskId: event.payload.taskId ? String(event.payload.taskId) : null,
      linkedTeamId: event.payload.teamId ? String(event.payload.teamId) : null
    });
  });
})().catch(error => console.error(JSON.stringify({ level: 'error', service: 'notification-service', message: 'RabbitMQ setup failed', error: String(error) })));

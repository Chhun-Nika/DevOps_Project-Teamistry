import 'dotenv/config';
import { createApp } from './app';
import { TaskServiceHttpClient } from './task-service-http-client';
import { connectEventBus, consumeWithRetry, publishEvent } from './event-bus';
import { getDatabase } from './database';

const port = Number(process.env.PORT ?? 3001);
const taskClient = new TaskServiceHttpClient(
  process.env.TASK_SERVICE_URL ?? 'http://localhost:3002',
  process.env.INTERNAL_SERVICE_TOKEN ?? ''
);
const runtimeApp = createApp(taskClient.getActiveTaskCount);

runtimeApp.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', service: 'user-team-service', message: `Listening on port ${port}` }));
});

void (async () => {
  const { channel } = await connectEventBus();
  const db = getDatabase();
  const publishPending = async () => {
    const events = await db.outboxEvent.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: 50 });
    for (const event of events) {
      publishEvent(channel, { eventId: event.id, eventType: event.eventType, occurredAt: event.createdAt.toISOString(), payload: event.data as Record<string, unknown> });
      await db.outboxEvent.update({ where: { id: event.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
    }
  };
  await consumeWithRetry(channel, 'user-team.events', ['TEAM_BOARD_READY'], async event => {
    const teamId = String(event.payload.teamId ?? '');
    if (teamId) await db.team.updateMany({ where: { id: teamId, boardProvisioningStatus: 'PENDING' }, data: { boardProvisioningStatus: 'READY' } });
  });
  await publishPending();
  setInterval(() => void publishPending().catch(error => console.error(JSON.stringify({ level: 'error', service: 'user-team-service', message: 'Outbox publish failed', error: String(error) }))), 2000);
})().catch(error => console.error(JSON.stringify({ level: 'error', service: 'user-team-service', message: 'RabbitMQ setup failed', error: String(error) })));

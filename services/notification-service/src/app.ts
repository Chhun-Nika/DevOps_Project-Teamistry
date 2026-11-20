import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { NotificationInboxService, NotificationNotFoundError } from './inbox';

export function createApp(inbox?: NotificationInboxService) {
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok', service: 'notification-service' });
});

if (inbox) {
  const identity = (request: express.Request) => request.header('x-user-id') ?? '';
  const event = z.object({
    sourceEventId: z.string().min(1),
    recipientId: z.string().min(1),
    eventType: z.enum(['TASK_ASSIGNED', 'TASK_REASSIGNED', 'TASK_STATUS_UPDATED', 'TASK_UPDATED', 'TASK_DELETED']),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(5000),
    payload: z.record(z.string(), z.unknown()).default({}),
    linkedTaskId: z.string().nullable().optional().default(null),
    linkedTeamId: z.string().nullable().optional().default(null)
  });
  const safe = (handler: (request: express.Request, response: express.Response) => Promise<void>) => async (request: express.Request, response: express.Response) => {
    try { await handler(request, response); }
    catch (error) {
      if (error instanceof NotificationNotFoundError) response.status(404).json({ error: error.message });
      else if (error instanceof z.ZodError) response.status(400).json({ error: error.message });
      else throw error;
    }
  };

  app.get('/notifications', safe(async (request, response) => {
    const userId = identity(request);
    if (!userId) { response.status(401).json({ error: 'Authentication required.' }); return; }
    response.json(await inbox.list(userId));
  }));

  app.patch('/notifications/:notificationId/read', safe(async (request, response) => {
    const userId = identity(request);
    if (!userId) { response.status(401).json({ error: 'Authentication required.' }); return; }
    response.json(await inbox.markRead(String(request.params.notificationId), userId));
  }));

  // Broker adapters call this boundary after authenticating the internal event.
  app.post('/internal/notifications/events', safe(async (request, response) => {
    response.status(201).json(await inbox.ingest(event.parse(request.body)));
  }));
}

return app;
}

export const app = createApp();

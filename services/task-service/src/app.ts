import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { ForbiddenError, NotFoundError, TaskLifecycleService, ValidationError } from './task-lifecycle';

export function createApp(lifecycle?: TaskLifecycleService) {
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok', service: 'task-service' });
});

if (lifecycle) {
  const actor = (request: express.Request) => request.header('x-user-id') ?? '';
  const createTask = z.object({ title: z.string().trim().min(1).max(200), description: z.string().max(5000).optional(), dueDate: z.coerce.date().optional(), assigneeId: z.string().min(1).optional() });
  const editTask = z.object({ title: z.string().trim().min(1).max(200).optional(), description: z.string().max(5000).nullable().optional(), dueDate: z.coerce.date().nullable().optional() });
  const content = z.object({ content: z.string().trim().min(1).max(5000) });
  const safe = (handler: (request: express.Request, response: express.Response) => Promise<void>) => async (request: express.Request, response: express.Response) => { try { await handler(request, response); } catch (error) { if (error instanceof ForbiddenError) response.status(403).json({ error: error.message }); else if (error instanceof NotFoundError) response.status(404).json({ error: error.message }); else if (error instanceof ValidationError || error instanceof z.ZodError) response.status(400).json({ error: error.message }); else throw error; } };

  const parameter = (req: express.Request, name: string) => String(req.params[name]);
  app.post('/teams/:teamId/tasks', safe(async (req, res) => { const value = createTask.parse(req.body); res.status(201).json(await lifecycle.create(actor(req), parameter(req, 'teamId'), value)); }));
  app.get('/teams/:teamId/tasks', safe(async (req, res) => { res.json(await lifecycle.list(actor(req), parameter(req, 'teamId'))); }));
  app.patch('/tasks/:taskId', safe(async (req, res) => { res.json(await lifecycle.edit(actor(req), parameter(req, 'taskId'), editTask.parse(req.body))); }));
  app.patch('/tasks/:taskId/assignee', safe(async (req, res) => { const value = z.object({ assigneeId: z.string().min(1) }).parse(req.body); res.json(await lifecycle.assign(actor(req), parameter(req, 'taskId'), value.assigneeId)); }));
  app.patch('/tasks/:taskId/status', safe(async (req, res) => { const value = z.object({ statusId: z.string().uuid() }).parse(req.body); res.json(await lifecycle.move(actor(req), parameter(req, 'taskId'), value.statusId)); }));
  app.delete('/tasks/:taskId', safe(async (req, res) => { await lifecycle.softDelete(actor(req), parameter(req, 'taskId')); res.status(204).end(); }));
  app.get('/tasks/:taskId/comments', safe(async (req, res) => { res.json(await lifecycle.listComments(actor(req), parameter(req, 'taskId'))); }));
  app.post('/tasks/:taskId/comments', safe(async (req, res) => { res.status(201).json(await lifecycle.addComment(actor(req), parameter(req, 'taskId'), content.parse(req.body).content)); }));
  app.patch('/comments/:commentId', safe(async (req, res) => { res.json(await lifecycle.editComment(actor(req), parameter(req, 'commentId'), content.parse(req.body).content)); }));
  app.delete('/comments/:commentId', safe(async (req, res) => { await lifecycle.softDeleteComment(actor(req), parameter(req, 'commentId')); res.status(204).end(); }));
}
return app;
}

export const app = createApp();

import type { PrismaClient } from './generated/prisma/client';
import type { Comment, Status, Task, TaskStore } from './task-lifecycle';

/** Prisma implementation; lifecycle rules stay database-agnostic and testable. */
export class PrismaTaskStore implements TaskStore {
  constructor(private readonly db: PrismaClient) {}
  async firstStatus(teamId: string): Promise<Status | null> { return this.db.boardStatus.findFirst({ where: { teamId, deletedAt: null }, orderBy: { position: 'asc' } }) as Promise<Status | null>; }
  async getStatus(id: string): Promise<Status | null> { return this.db.boardStatus.findUnique({ where: { id } }) as Promise<Status | null>; }
  async getTask(id: string): Promise<Task | null> { return this.db.task.findUnique({ where: { id } }) as Promise<Task | null>; }
  async listTasks(teamId: string): Promise<Task[]> { return this.db.task.findMany({ where: { teamId, deletedAt: null }, orderBy: { createdAt: 'asc' } }) as Promise<Task[]>; }
  async createTask(data: Omit<Task, 'id' | 'deletedAt'>): Promise<Task> { return this.db.task.create({ data }) as Promise<Task>; }
  async updateTask(id: string, data: Partial<Omit<Task, 'id' | 'teamId' | 'creatorId'>>): Promise<Task> { return this.db.task.update({ where: { id }, data }) as Promise<Task>; }
  async createOutbox(data: { eventType: 'TASK_ASSIGNED' | 'TASK_REASSIGNED' | 'TASK_STATUS_UPDATED' | 'TASK_UPDATED' | 'TASK_DELETED'; teamId: string; taskId: string; recipientId: string; payload: Record<string, unknown> }): Promise<void> { await this.db.taskOutboxEvent.create({ data: data as never }); }
  async listComments(taskId: string): Promise<Comment[]> { return this.db.comment.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } }) as Promise<Comment[]>; }
  async createComment(data: Omit<Comment, 'id' | 'deletedAt' | 'createdAt'>): Promise<Comment> { return this.db.comment.create({ data }) as Promise<Comment>; }
  async getComment(id: string): Promise<Comment | null> { return this.db.comment.findUnique({ where: { id } }) as Promise<Comment | null>; }
  async updateComment(id: string, data: Partial<Pick<Comment, 'content' | 'deletedAt'>>): Promise<Comment> { return this.db.comment.update({ where: { id }, data }) as Promise<Comment>; }
}

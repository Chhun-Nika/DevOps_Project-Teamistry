import type { MembershipChecker, TeamRole } from './membership';

export type Status = { id: string; teamId: string; isDone: boolean; deletedAt: Date | null; position: number };
export type Task = { id: string; teamId: string; creatorId: string; assigneeId: string; title: string; description: string | null; dueDate: Date | null; statusId: string; completedAt: Date | null; deletedAt: Date | null };
export type Comment = { id: string; taskId: string; authorId: string; content: string; deletedAt: Date | null; createdAt: Date };

export interface TaskStore {
  firstStatus(teamId: string): Promise<Status | null>;
  getStatus(statusId: string): Promise<Status | null>;
  getTask(taskId: string): Promise<Task | null>;
  listTasks(teamId: string): Promise<Task[]>;
  createTask(data: Omit<Task, 'id' | 'deletedAt'>): Promise<Task>;
  updateTask(taskId: string, data: Partial<Omit<Task, 'id' | 'teamId' | 'creatorId'>>): Promise<Task>;
  createOutbox(data: { eventType: 'TASK_ASSIGNED' | 'TASK_REASSIGNED' | 'TASK_STATUS_UPDATED' | 'TASK_UPDATED' | 'TASK_DELETED'; teamId: string; taskId: string; recipientId: string; payload: Record<string, unknown> }): Promise<void>;
  listComments(taskId: string): Promise<Comment[]>;
  createComment(data: Omit<Comment, 'id' | 'deletedAt' | 'createdAt'>): Promise<Comment>;
  getComment(commentId: string): Promise<Comment | null>;
  updateComment(commentId: string, data: Partial<Pick<Comment, 'content' | 'deletedAt'>>): Promise<Comment>;
}

export class ForbiddenError extends Error {}
export class NotFoundError extends Error {}
export class ValidationError extends Error {}

export class TaskLifecycleService {
  constructor(private readonly store: TaskStore, private readonly memberships: MembershipChecker) {}

  private async member(teamId: string, userId: string): Promise<TeamRole> {
    const membership = await this.memberships.getMembership(teamId, userId);
    if (!membership?.active) throw new ForbiddenError('Active team membership is required.');
    return membership.role;
  }

  private manager(role: TeamRole): boolean { return role === 'OWNER' || role === 'LEADER'; }

  private async activeAssignee(teamId: string, userId: string): Promise<void> {
    const membership = await this.memberships.getMembership(teamId, userId);
    if (!membership?.active) throw new ValidationError('Assignee must be an active team member.');
  }

  async create(actorId: string, teamId: string, input: { title: string; description?: string; dueDate?: Date; assigneeId?: string }): Promise<Task> {
    const role = await this.member(teamId, actorId);
    const status = await this.store.firstStatus(teamId);
    if (!status) throw new ValidationError('BOARD_NOT_READY');
    const assigneeId = this.manager(role) ? input.assigneeId ?? actorId : actorId;
    await this.activeAssignee(teamId, assigneeId);
    const task = await this.store.createTask({ teamId, creatorId: actorId, assigneeId, title: input.title, description: input.description ?? null, dueDate: input.dueDate ?? null, statusId: status.id, completedAt: status.isDone ? new Date() : null });
    if (assigneeId !== actorId) await this.store.createOutbox({ eventType: 'TASK_ASSIGNED', teamId, taskId: task.id, recipientId: assigneeId, payload: { taskId: task.id } });
    return task;
  }

  async list(actorId: string, teamId: string): Promise<Task[]> { await this.member(teamId, actorId); return this.store.listTasks(teamId); }

  async edit(actorId: string, taskId: string, input: { title?: string; description?: string | null; dueDate?: Date | null }): Promise<Task> {
    const task = await this.requiredTask(taskId); const role = await this.member(task.teamId, actorId);
    if (!this.manager(role) && task.creatorId !== actorId) throw new ForbiddenError('Only the creator may edit this task.');
    const updated = await this.store.updateTask(taskId, input);
    if (updated.assigneeId !== actorId) await this.store.createOutbox({ eventType: 'TASK_UPDATED', teamId: updated.teamId, taskId, recipientId: updated.assigneeId, payload: { taskId } });
    return updated;
  }

  async assign(actorId: string, taskId: string, assigneeId: string): Promise<Task> {
    const task = await this.requiredTask(taskId); if (!this.manager(await this.member(task.teamId, actorId))) throw new ForbiddenError('Only a leader may assign tasks.');
    await this.activeAssignee(task.teamId, assigneeId); const updated = await this.store.updateTask(taskId, { assigneeId });
    if (task.assigneeId !== assigneeId) {
      for (const recipientId of new Set([task.assigneeId, assigneeId])) {
        if (recipientId !== actorId) {
          await this.store.createOutbox({ eventType: 'TASK_REASSIGNED', teamId: task.teamId, taskId, recipientId, payload: { taskId, previousAssigneeId: task.assigneeId } });
        }
      }
    }
    return updated;
  }

  async move(actorId: string, taskId: string, statusId: string): Promise<Task> {
    const task = await this.requiredTask(taskId); const role = await this.member(task.teamId, actorId);
    if (!this.manager(role) && task.assigneeId !== actorId) throw new ForbiddenError('Only the assignee may move this task.');
    const status = await this.store.getStatus(statusId); if (!status || status.deletedAt || status.teamId !== task.teamId) throw new ValidationError('Status must be active and on the same team.');
    const updated = await this.store.updateTask(taskId, { statusId, completedAt: status.isDone ? new Date() : null });
    if (task.creatorId !== actorId) await this.store.createOutbox({ eventType: 'TASK_STATUS_UPDATED', teamId: task.teamId, taskId, recipientId: task.creatorId, payload: { taskId, statusId } });
    return updated;
  }

  async softDelete(actorId: string, taskId: string): Promise<void> {
    const task = await this.requiredTask(taskId); const role = await this.member(task.teamId, actorId);
    if (!this.manager(role) && task.creatorId !== actorId) throw new ForbiddenError('Only the creator may delete this task.');
    await this.store.updateTask(taskId, { deletedAt: new Date() });
    if (task.assigneeId !== actorId) await this.store.createOutbox({ eventType: 'TASK_DELETED', teamId: task.teamId, taskId, recipientId: task.assigneeId, payload: { taskId } });
  }

  async listComments(actorId: string, taskId: string): Promise<Array<Comment & { placeholder: boolean }>> { const task = await this.requiredTask(taskId); await this.member(task.teamId, actorId); return (await this.store.listComments(taskId)).map((comment) => comment.deletedAt ? { ...comment, content: 'Comment deleted', placeholder: true } : { ...comment, placeholder: false }); }
  async addComment(actorId: string, taskId: string, content: string): Promise<Comment> { const task = await this.requiredTask(taskId); await this.member(task.teamId, actorId); return this.store.createComment({ taskId, authorId: actorId, content }); }
  async editComment(actorId: string, commentId: string, content: string): Promise<Comment> { const comment = await this.requiredComment(commentId); const task = await this.requiredTask(comment.taskId); await this.member(task.teamId, actorId); if (comment.authorId !== actorId || comment.deletedAt) throw new ForbiddenError('Only the comment author may edit it.'); return this.store.updateComment(commentId, { content }); }
  async softDeleteComment(actorId: string, commentId: string): Promise<void> { const comment = await this.requiredComment(commentId); const task = await this.requiredTask(comment.taskId); await this.member(task.teamId, actorId); if (comment.authorId !== actorId || comment.deletedAt) throw new ForbiddenError('Only the comment author may delete it.'); await this.store.updateComment(commentId, { deletedAt: new Date() }); }
  private async requiredTask(id: string): Promise<Task> { const task = await this.store.getTask(id); if (!task || task.deletedAt) throw new NotFoundError('Task not found.'); return task; }
  private async requiredComment(id: string): Promise<Comment> { const comment = await this.store.getComment(id); if (!comment) throw new NotFoundError('Comment not found.'); return comment; }
}

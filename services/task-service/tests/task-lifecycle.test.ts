import type { MembershipChecker } from '../src/membership';
import { ForbiddenError, TaskLifecycleService, type Comment, type Status, type Task, type TaskStore, ValidationError } from '../src/task-lifecycle';

class MemoryStore implements TaskStore {
  readonly statuses: Status[] = [{ id: 'todo', teamId: 'team-1', isDone: false, deletedAt: null, position: 1 }, { id: 'done', teamId: 'team-1', isDone: true, deletedAt: null, position: 2 }];
  readonly tasks: Task[] = [];
  readonly comments: Comment[] = [];
  readonly outbox: Array<{ eventType: string; recipientId: string }> = [];
  private number = 0;
  async firstStatus(teamId: string) { return this.statuses.filter((status) => status.teamId === teamId && !status.deletedAt).sort((a, b) => a.position - b.position)[0] ?? null; }
  async getStatus(id: string) { return this.statuses.find((status) => status.id === id) ?? null; }
  async getTask(id: string) { return this.tasks.find((task) => task.id === id) ?? null; }
  async listTasks(teamId: string) { return this.tasks.filter((task) => task.teamId === teamId && !task.deletedAt); }
  async createTask(data: Omit<Task, 'id' | 'deletedAt'>) { const task = { ...data, id: `task-${++this.number}`, deletedAt: null }; this.tasks.push(task); return task; }
  async updateTask(id: string, data: Partial<Omit<Task, 'id' | 'teamId' | 'creatorId'>>) { const task = (await this.getTask(id))!; Object.assign(task, data); return task; }
  async createOutbox(data: { eventType: 'TASK_ASSIGNED' | 'TASK_REASSIGNED' | 'TASK_STATUS_UPDATED' | 'TASK_UPDATED' | 'TASK_DELETED'; recipientId: string }) { this.outbox.push(data); }
  async listComments(taskId: string) { return this.comments.filter((comment) => comment.taskId === taskId); }
  async createComment(data: Omit<Comment, 'id' | 'deletedAt' | 'createdAt'>) { const comment = { ...data, id: `comment-${++this.number}`, deletedAt: null, createdAt: new Date() }; this.comments.push(comment); return comment; }
  async getComment(id: string) { return this.comments.find((comment) => comment.id === id) ?? null; }
  async updateComment(id: string, data: Partial<Pick<Comment, 'content' | 'deletedAt'>>) { const comment = (await this.getComment(id))!; Object.assign(comment, data); return comment; }
}

const checker = (members: Record<string, { active: boolean; role: 'OWNER' | 'LEADER' | 'MEMBER' }>): MembershipChecker => ({ getMembership: async (_teamId, userId) => members[userId] ?? null });

describe('TaskLifecycleService', () => {
  it('applies role and assignee rules and persists notifications', async () => {
    const store = new MemoryStore();
    const service = new TaskLifecycleService(store, checker({ owner: { active: true, role: 'OWNER' }, member: { active: true, role: 'MEMBER' }, inactive: { active: false, role: 'MEMBER' } }));
    const task = await service.create('owner', 'team-1', { title: 'Review', assigneeId: 'member' });
    expect(task.assigneeId).toBe('member');
    expect(store.outbox).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'TASK_ASSIGNED', recipientId: 'member' })]));
    await expect(service.assign('member', task.id, 'owner')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.assign('owner', task.id, 'inactive')).rejects.toBeInstanceOf(ValidationError);
    const memberTask = await service.create('member', 'team-1', { title: 'Mine', assigneeId: 'owner' });
    expect(memberTask.assigneeId).toBe('member');
  });

  it('soft-deletes tasks and lets the assignee move a task into done', async () => {
    const store = new MemoryStore(); const service = new TaskLifecycleService(store, checker({ owner: { active: true, role: 'OWNER' }, member: { active: true, role: 'MEMBER' } }));
    const task = await service.create('owner', 'team-1', { title: 'Ship', assigneeId: 'member' });
    const moved = await service.move('member', task.id, 'done');
    expect(moved.completedAt).toBeInstanceOf(Date);
    await service.softDelete('owner', task.id);
    expect(await service.list('owner', 'team-1')).toEqual([]);
  });

  it('limits comment changes to the author and returns a deleted placeholder', async () => {
    const store = new MemoryStore(); const service = new TaskLifecycleService(store, checker({ owner: { active: true, role: 'OWNER' }, member: { active: true, role: 'MEMBER' } }));
    const task = await service.create('owner', 'team-1', { title: 'Discuss' });
    const comment = await service.addComment('member', task.id, 'I can help');
    await expect(service.editComment('owner', comment.id, 'Changed')).rejects.toBeInstanceOf(ForbiddenError);
    await service.softDeleteComment('member', comment.id);
    await expect(service.editComment('member', comment.id, 'Changed')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.listComments('owner', task.id)).resolves.toEqual([expect.objectContaining({ content: 'Comment deleted', placeholder: true })]);
  });
});

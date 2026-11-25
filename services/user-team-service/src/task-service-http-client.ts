import type { ActiveTaskCheck } from './team-deletion-routes';

export class TaskServiceHttpClient {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  getActiveTaskCount: ActiveTaskCheck = async (teamId, userId) => {
    const response = await fetch(`${this.baseUrl}/internal/teams/${teamId}/members/${userId}/active-task-summary`, {
      headers: { 'X-Service-Token': this.token }
    });
    if (!response.ok) throw new Error(`Task Service returned ${response.status}.`);
    const body = await response.json() as { activeTaskCount?: unknown };
    if (!Number.isSafeInteger(body.activeTaskCount) || (body.activeTaskCount as number) < 0) throw new Error('Invalid active-task response.');
    return body.activeTaskCount as number;
  };
}

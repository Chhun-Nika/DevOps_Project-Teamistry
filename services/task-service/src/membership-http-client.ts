import type { Membership, MembershipChecker } from './membership';

export class MembershipDependencyError extends Error {}

export class MembershipHttpClient implements MembershipChecker {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  async getMembership(teamId: string, userId: string): Promise<Membership | null> {
    try {
      const response = await fetch(`${this.baseUrl}/internal/teams/${teamId}/members/${userId}`, {
        headers: { 'X-Service-Token': this.token }
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new MembershipDependencyError(`Membership service returned ${response.status}.`);
      const body = await response.json() as { isActiveMember?: boolean; role?: Membership['role'] };
      return body.isActiveMember && body.role ? { active: true, role: body.role } : { active: false, role: 'MEMBER' };
    } catch (error) {
      if (error instanceof MembershipDependencyError) throw error;
      throw new MembershipDependencyError('Membership service is unavailable.');
    }
  }
}

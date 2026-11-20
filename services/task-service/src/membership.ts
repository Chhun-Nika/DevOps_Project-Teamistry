export type TeamRole = 'OWNER' | 'LEADER' | 'MEMBER';

export type Membership = { active: boolean; role: TeamRole };

/** Replaced by the User & Team Service HTTP client when that service is ready. */
export interface MembershipChecker {
  getMembership(teamId: string, userId: string): Promise<Membership | null>;
}

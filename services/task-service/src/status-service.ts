export const DEFAULT_BOARD_STATUSES = [
  { name: 'TODO', position: 1, isDone: false },
  { name: 'IN_PROGRESS', position: 2, isDone: false },
  { name: 'DONE', position: 3, isDone: true }
] as const;

export const MAX_ACTIVE_STATUSES = 5;

export class StatusLimitError extends Error {
  constructor() {
    super(`A board cannot have more than ${MAX_ACTIVE_STATUSES} active statuses.`);
    this.name = 'StatusLimitError';
  }
}

type BoardStatusRecord = {
  id: string;
  teamId: string;
  name: string;
  position: number;
  isDone: boolean;
  deletedAt: Date | null;
};

/** The narrow Prisma surface used by status rules; it also makes rules easy to unit test. */
export type StatusStore = {
  boardStatus: {
    count(args: { where: { teamId: string; deletedAt: null } }): Promise<number>;
    create(args: { data: { teamId: string; name: string; position: number; isDone: boolean } }): Promise<BoardStatusRecord>;
    upsert(args: {
      where: { teamId_name: { teamId: string; name: string } };
      create: { teamId: string; name: string; position: number; isDone: boolean };
      update: Record<string, never>;
    }): Promise<BoardStatusRecord>;
    findMany(args: { where: { teamId: string; deletedAt: null }; orderBy: { position: 'asc' } }): Promise<BoardStatusRecord[]>;
  };
  $transaction<T>(operations: Promise<T>[]): Promise<T[]>;
};

export class StatusService {
  constructor(private readonly db: StatusStore) {}

  /**
   * Safe for duplicate TEAM_CREATED deliveries. The compound unique key means
   * each canonical status is created once, even when initialization is retried.
   */
  async initializeDefaultBoard(teamId: string): Promise<BoardStatusRecord[]> {
    await this.db.$transaction(
      DEFAULT_BOARD_STATUSES.map((status) =>
        this.db.boardStatus.upsert({
          where: { teamId_name: { teamId, name: status.name } },
          create: { teamId, ...status },
          update: {}
        })
      )
    );

    return this.listActiveStatuses(teamId);
  }

  async listActiveStatuses(teamId: string): Promise<BoardStatusRecord[]> {
    return this.db.boardStatus.findMany({
      where: { teamId, deletedAt: null },
      orderBy: { position: 'asc' }
    });
  }

  async addStatus(
    teamId: string,
    input: { name: string; position: number; isDone?: boolean }
  ): Promise<BoardStatusRecord> {
    const activeCount = await this.db.boardStatus.count({ where: { teamId, deletedAt: null } });
    if (activeCount >= MAX_ACTIVE_STATUSES) {
      throw new StatusLimitError();
    }

    return this.db.boardStatus.create({
      data: { teamId, name: input.name, position: input.position, isDone: input.isDone ?? false }
    });
  }
}

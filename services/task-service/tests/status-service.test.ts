import { DEFAULT_BOARD_STATUSES, MAX_ACTIVE_STATUSES, StatusLimitError, StatusService, type StatusStore } from '../src/status-service';

type Row = {
  id: string;
  teamId: string;
  name: string;
  position: number;
  isDone: boolean;
  deletedAt: Date | null;
};

function createStore(rows: Row[] = []): StatusStore {
  let nextId = rows.length + 1;
  return {
    boardStatus: {
      count: async ({ where }) => rows.filter((row) => row.teamId === where.teamId && row.deletedAt === null).length,
      create: async ({ data }) => {
        const row = { id: String(nextId++), ...data, deletedAt: null };
        rows.push(row);
        return row;
      },
      upsert: async ({ where, create }) => {
        const found = rows.find((row) => row.teamId === where.teamId_name.teamId && row.name === where.teamId_name.name);
        if (found) return found;
        const row = { id: String(nextId++), ...create, deletedAt: null };
        rows.push(row);
        return row;
      },
      findMany: async ({ where }) => rows
        .filter((row) => row.teamId === where.teamId && row.deletedAt === null)
        .sort((left, right) => left.position - right.position)
    },
    $transaction: async (operations) => Promise.all(operations)
  };
}

describe('StatusService', () => {
  it('initializes a new board with the three canonical statuses only once', async () => {
    const service = new StatusService(createStore());

    await service.initializeDefaultBoard('team-1');
    const statuses = await service.initializeDefaultBoard('team-1');

    expect(statuses.map(({ name, position, isDone }) => ({ name, position, isDone }))).toEqual(DEFAULT_BOARD_STATUSES);
  });

  it('rejects a sixth active status', async () => {
    const rows = Array.from({ length: MAX_ACTIVE_STATUSES }, (_, index) => ({
      id: String(index + 1), teamId: 'team-1', name: `STATUS_${index + 1}`, position: index + 1, isDone: false, deletedAt: null
    }));
    const service = new StatusService(createStore(rows));

    await expect(service.addStatus('team-1', { name: 'TOO_MANY', position: 6 })).rejects.toBeInstanceOf(StatusLimitError);
  });
});

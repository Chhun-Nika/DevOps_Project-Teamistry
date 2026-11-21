import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client';

let database: PrismaClient | undefined;

export function getDatabase(): PrismaClient {
  if (!database) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for User & Team database operations');
    }

    database = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }

  return database;
}

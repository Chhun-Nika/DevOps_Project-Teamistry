import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from './generated/prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL must be configured before creating Prisma Client.');
}

const adapter = new PrismaPg(new Pool({ connectionString: databaseUrl }));

/**
 * One client per process. Keeping it here prevents connection-pool growth when
 * modules are reloaded during local development and gives domain services one
 * shared database boundary.
 */
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

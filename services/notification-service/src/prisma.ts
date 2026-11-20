import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from './generated/prisma/client';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must be configured before creating Prisma Client.');

const globalForPrisma = globalThis as unknown as { notificationPrisma?: PrismaClient };
const adapter = new PrismaPg(new Pool({ connectionString: databaseUrl }));
export const prisma = globalForPrisma.notificationPrisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') globalForPrisma.notificationPrisma = prisma;

import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations'
  },
  datasource: {
    // `prisma generate` validates this value but does not connect. Migrations
    // and the runtime always provide DATABASE_URL through Compose or .env.
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/task_db'
  }
});

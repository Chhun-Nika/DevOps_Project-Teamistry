/// <reference types="node" />

import { env } from 'node:process';

import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Generation and schema validation also run in CI without a database.
  datasource: { url: env.DATABASE_URL },
});

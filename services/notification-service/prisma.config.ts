import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Generate validates this value but does not connect. Runtime migrations
    // receive the real URL from Compose or the service .env file.
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/notification_db'
  }
});

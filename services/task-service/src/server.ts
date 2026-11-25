import 'dotenv/config';
import { createApp } from './app';
import type { MembershipChecker } from './membership';
import { prisma } from './prisma';
import { PrismaTaskStore } from './prisma-task-store';
import { TaskLifecycleService } from './task-lifecycle';
import { MembershipHttpClient } from './membership-http-client';

const port = Number(process.env.PORT ?? 3002);
const memberships: MembershipChecker = new MembershipHttpClient(
  process.env.USER_TEAM_SERVICE_URL ?? 'http://localhost:3001',
  process.env.INTERNAL_SERVICE_TOKEN ?? ''
);
const app = createApp(new TaskLifecycleService(new PrismaTaskStore(prisma), memberships), prisma);

app.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', service: 'task-service', message: `Listening on port ${port}` }));
});

import 'dotenv/config';
import { createApp } from './app';
import type { MembershipChecker } from './membership';
import { prisma } from './prisma';
import { PrismaTaskStore } from './prisma-task-store';
import { TaskLifecycleService } from './task-lifecycle';

const port = Number(process.env.PORT ?? 3002);
const unavailableMemberships: MembershipChecker = { getMembership: async () => null };
const app = createApp(new TaskLifecycleService(new PrismaTaskStore(prisma), unavailableMemberships));

app.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', service: 'task-service', message: `Listening on port ${port}` }));
});

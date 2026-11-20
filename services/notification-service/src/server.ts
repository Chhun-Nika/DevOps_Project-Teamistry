import 'dotenv/config';
import { createApp } from './app';
import { prisma } from './prisma';
import { PrismaInboxStore } from './prisma-inbox-store';
import { NotificationInboxService } from './inbox';

const port = Number(process.env.PORT ?? 3003);
const app = createApp(new NotificationInboxService(new PrismaInboxStore(prisma)));

app.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', service: 'notification-service', message: `Listening on port ${port}` }));
});

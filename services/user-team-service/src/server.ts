import 'dotenv/config';
import { createApp } from './app';
import { TaskServiceHttpClient } from './task-service-http-client';

const port = Number(process.env.PORT ?? 3001);
const taskClient = new TaskServiceHttpClient(
  process.env.TASK_SERVICE_URL ?? 'http://localhost:3002',
  process.env.INTERNAL_SERVICE_TOKEN ?? ''
);
const runtimeApp = createApp(taskClient.getActiveTaskCount);

runtimeApp.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', service: 'user-team-service', message: `Listening on port ${port}` }));
});

import 'dotenv/config';
import { app } from './app';

const port = Number(process.env.PORT ?? 3003);

app.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', service: 'notification-service', message: `Listening on port ${port}` }));
});

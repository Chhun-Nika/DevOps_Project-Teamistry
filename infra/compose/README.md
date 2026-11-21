# Docker Compose

`compose.local.yaml` starts the Teamisty local development stack:

- React/Vite frontend
- User & Team, Task, and Notification Services
- One PostgreSQL database per backend service
- RabbitMQ with its management interface

## Start the stack

From the monorepo root:

```bash
cp infra/compose/.env.example infra/compose/.env
docker compose \
  --file infra/compose/compose.local.yaml \
  --env-file infra/compose/.env \
  up --build
```

## Local endpoints

| Component | URL |
| --- | --- |
| Frontend | `http://localhost:5173` |
| User & Team health | `http://localhost:3001/health` |
| Task health | `http://localhost:3002/health` |
| Notification health | `http://localhost:3003/health` |
| RabbitMQ management | `http://localhost:15672` |
| Swagger UI (optional) | `http://localhost:8081` |

The gateway is intentionally not included until Caddy or Nginx is selected. Backend ports are temporarily exposed only for local development and health verification.

Start the optional API reference separately with `docker compose -f infra/compose/compose.local.yaml --env-file infra/compose/.env up -d swagger-ui`. See the [OpenAPI README](../../contracts/openapi/README.md) for browser testing setup.

## Stop or reset

```bash
docker compose --file infra/compose/compose.local.yaml down
```

To remove local database and RabbitMQ data as well:

```bash
docker compose --file infra/compose/compose.local.yaml down -v
```

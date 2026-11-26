# Docker Compose

`compose.local.yaml` starts the Teamisty local development stack:

- React/Vite frontend
- User & Team, Task, and Notification Services
- One PostgreSQL database per backend service
- RabbitMQ with its management interface
- Caddy API gateway on port 8080

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
| Public API gateway | `http://localhost:8080` |
| RabbitMQ management | `http://localhost:15672` |
| Swagger UI (optional) | `http://localhost:8081` |

The gateway is the public local entry point on port 8080. Backend ports remain exposed temporarily for local development and health verification; internal service routes are not routed through the gateway.

Start the optional API reference separately with `docker compose -f infra/compose/compose.local.yaml --env-file infra/compose/.env up -d swagger-ui`. See the [OpenAPI README](../../contracts/openapi/README.md) for browser testing setup.

## Stop or reset

```bash
docker compose --file infra/compose/compose.local.yaml down
```

To remove local database and RabbitMQ data as well:

```bash
docker compose --file infra/compose/compose.local.yaml down -v
```

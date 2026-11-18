# Teamisty

Teamisty is a task-management application built as a microservices project.

## Repository layout

- `frontend/` — web application.
- `services/` — independently deployable backend services.
- `contracts/` — API and asynchronous event contracts shared between services.
- `infra/` — infrastructure configuration for local and deployed environments.
- `.github/workflows/` — CI/CD workflows.
- `docs/` — approved product, technical, and implementation documentation.

## Run locally with Docker

### Prerequisite

Install and start [Docker Desktop](https://www.docker.com/products/docker-desktop/). It provides Docker and Docker Compose for the project.

### Build and start

From this repository's root directory, create your local environment file once, then build and start the complete stack:

```bash
cp infra/compose/.env.example infra/compose/.env
docker compose \
  --file infra/compose/compose.local.yaml \
  --env-file infra/compose/.env \
  up --build
```

Use `Ctrl+C` to stop the foreground command. To keep the containers running in the background instead, add `--detach`:

```bash
docker compose \
  --file infra/compose/compose.local.yaml \
  --env-file infra/compose/.env \
  up --build --detach
```

### Open the application

| Component | URL |
| --- | --- |
| Frontend | `http://localhost:5173` |
| User & Team Service health | `http://localhost:3001/health` |
| Task Service health | `http://localhost:3002/health` |
| Notification Service health | `http://localhost:3003/health` |
| RabbitMQ management | `http://localhost:15672` |

### Stop or reset

Stop and remove the project containers and network while retaining database and RabbitMQ data:

```bash
docker compose --file infra/compose/compose.local.yaml down
```

To also permanently remove local database and RabbitMQ data:

```bash
docker compose --file infra/compose/compose.local.yaml down -v
```

More Docker-specific detail is available in [the Compose README](infra/compose/README.md).

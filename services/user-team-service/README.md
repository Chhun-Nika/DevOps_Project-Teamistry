# User & Team Service

This service will manage authentication, user accounts, teams, memberships, ownership, leadership, and invitations.

Implementation setup, API details, events, environment variables, tests, and operating instructions will be added after the service workspace is configured.

## Apply the local database migrations

From the monorepo root, with `infra/compose/.env` already configured:

```bash
docker compose --file infra/compose/compose.local.yaml --env-file infra/compose/.env \
  up --detach --wait user-team-db
docker compose --file infra/compose/compose.local.yaml --env-file infra/compose/.env \
  build user-team-service
docker compose --file infra/compose/compose.local.yaml --env-file infra/compose/.env \
  run --rm --no-deps user-team-service npm run prisma:migrate:deploy
```

The one-off container uses the service's Compose `DATABASE_URL` and applies any pending migrations to `user-team-db`. Repeat the migration command after pulling a new migration.

## Local container verification

Build from the monorepo root so npm workspace files are available:

```bash
docker build \
  --file services/user-team-service/Dockerfile \
  --tag teamisty/user-team-service:local \
  .
```

Run and verify the container:

```bash
docker run --rm --publish 3001:3001 teamisty/user-team-service:local
curl http://localhost:3001/health
```

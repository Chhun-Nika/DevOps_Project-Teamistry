# Task Service

This service will manage board statuses, tasks, comments, soft deletion, and task-related asynchronous events.

Implementation setup, API details, events, environment variables, tests, and operating instructions will be added after the service workspace is configured.

## Local container verification

Build from the monorepo root so npm workspace files are available:

```bash
docker build \
  --file services/task-service/Dockerfile \
  --tag teamisty/task-service:local \
  .
```

Run and verify the container:

```bash
docker run --rm --publish 3002:3002 teamisty/task-service:local
curl http://localhost:3002/health
```

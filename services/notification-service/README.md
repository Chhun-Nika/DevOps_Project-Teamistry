# Notification Service

This service will manage in-app notification records, unread/read state, and idempotent processing of notification events.

Implementation setup, event handling, environment variables, tests, and operating instructions will be added after the service workspace is configured.

## Local container verification

Build from the monorepo root so npm workspace files are available:

```bash
docker build \
  --file services/notification-service/Dockerfile \
  --tag teamisty/notification-service:local \
  .
```

Run and verify the container:

```bash
docker run --rm --publish 3003:3003 teamisty/notification-service:local
curl http://localhost:3003/health
```

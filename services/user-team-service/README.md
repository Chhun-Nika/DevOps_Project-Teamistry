# User & Team Service

This service will manage authentication, user accounts, teams, memberships, ownership, leadership, and invitations.

Implementation setup, API details, events, environment variables, tests, and operating instructions will be added after the service workspace is configured.

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

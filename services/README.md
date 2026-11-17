# Backend Services

This directory contains Teamisty's independently deployable backend services:

- `user-team-service/` — identity, teams, memberships, roles, and invitations.
- `task-service/` — board statuses, tasks, comments, and task events.
- `notification-service/` — in-app notifications and read state.

Each service keeps its own source code, Prisma schema/migrations, tests, dependencies, and later its Dockerfile.

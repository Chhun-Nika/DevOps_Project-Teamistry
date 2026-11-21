# Teamisty — Implementation Guide

**Status:** Review draft — proposed source of truth for delivery work  
**Last updated:** 2026-11-16

## 1. Agreed stack

| Area | Technology |
| --- | --- |
| Frontend | React, Vite, TypeScript |
| Services | Node.js, TypeScript, Express |
| Databases | PostgreSQL; one database per service |
| ORM | Prisma |
| Authentication | JWT, bcrypt, Google OAuth |
| Tests | Jest and Supertest |
| Local runtime | Docker and Docker Compose |
| Asynchronous messaging | RabbitMQ |
| CI/CD | GitHub Actions |
| Frontend hosting | Netlify |

## 2. Intended repository layout

```text
frontend/
services/
  user-service/
  task-service/
  notification-service/
infra/
  compose/
  monitoring/
  logging/
.github/workflows/
docs/
```

Each service has its own `package.json`, Express application, Prisma schema and migrations, tests, Dockerfile, environment example, and health/metrics endpoints.

## 3. Recommended build order

1. Create the monorepo structure and shared API/error conventions.
2. Implement User & Team Service authentication, teams, memberships, and invitations.
3. Implement Task Service, membership validation, board statuses, and task rules.
4. Implement Notification Service and idempotent notification creation.
5. Add gateway routing and the frontend primary journey.
6. Add Dockerfiles and Docker Compose for the full local stack.
7. Add unit, integration, and cross-service tests.
8. Add CI/CD image build and registry publishing.
9. Deploy services and frontend.
10. Add central logs, metrics dashboards, and the error-investigation demonstration.

## 4. Testing expectations

- Add or update the service's [OpenAPI contract](../contracts/openapi/README.md) in the same PR as any HTTP endpoint addition or behavior change. Verify its paths, inputs, responses, and authentication requirements against the implementation. Swagger UI is optional.
- Unit tests cover validation, role rules, invitation transitions, status rules, and notification deduplication.
- API integration tests cover authentication and all protected endpoints.
- Cross-service tests cover membership validation, invalid-assignee handling, member removal with active tasks, and notification retry behaviour.
- CI runs tests before building and publishing images.

## 5. Delivery requirements

- Every backend service has a Dockerfile.
- Docker Compose starts the gateway, frontend, all services, and three private databases locally.
- GitHub Actions runs tests, builds images, and publishes approved images to a registry.
- The frontend deploys from `frontend/` and receives its public gateway URL using `VITE_API_BASE_URL`.
- Secrets are supplied through environment configuration and never committed.
- Production keeps service and database ports private behind the gateway.

## 6. Observability and demonstration evidence

Required evidence includes:

- Docker Compose startup output.
- Passing CI workflow and published image links/tags.
- Deployed frontend/API link.
- Grafana dashboard and searchable central-log screenshots.
- A traceable error demonstration: submit an invalid assignee ID, show the User & Team validation response and Task Service failure using one correlation ID, then show the failed-request metric.
- Report and presentation links/materials.

## 7. Definition of done

The project is ready to demonstrate when the primary user journey works through the deployed frontend, APIs enforce permissions and validation, the full stack is reproducible locally, CI builds and publishes images, deployment is available, and logs plus metrics support the planned investigation scenario.


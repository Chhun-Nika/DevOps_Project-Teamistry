# OpenAPI Contracts

An OpenAPI specification is a machine-readable YAML or JSON file that describes an HTTP API. It records each endpoint's method and path, inputs, response bodies and status codes, and authentication requirements. Frontend developers can use it to see what to send and what to expect. Automated tools can use it to validate the contract or generate client code.

Each service owner maintains one spec in this directory. Add or update the contract in the same PR as the endpoint change.

- [User & Team](user-team.yaml) covers health, authentication, profile, and team and member endpoints.
- Task will use `task.yaml` for boards, statuses, tasks, and comments.
- Notification will use `notification.yaml` for the inbox and read state.

Identify internal REST endpoints and their authentication requirements explicitly. A public-facing API reference should include only public operations. Record RabbitMQ message contracts under [events](../events/).

## View in Swagger UI

Start the optional local viewer from the monorepo root:

```bash
docker compose -f infra/compose/compose.local.yaml --env-file infra/compose/.env \
  up -d swagger-ui
```

Open [Swagger UI](http://localhost:8081). The viewer works while the API is stopped and loads the YAML directly from this directory. When another public service spec is ready, add its read-only mount and selector entry under `swagger-ui` in Compose.

To use **Try it out**, add `http://localhost:8081` to the existing `AUTH_TRUSTED_ORIGINS` list in your local Compose `.env` and recreate the User & Team container:

```bash
docker compose -f infra/compose/compose.local.yaml --env-file infra/compose/.env \
  up -d --build --no-deps --force-recreate user-team-service
```

For authentication endpoints, the [User & Team database must be running and migrated](../../services/user-team-service/README.md#apply-the-local-database-migrations). Use the same `localhost` hostname for the viewer and API so the browser can send the refresh cookie. Use **Authorize** with an access token for `GET /users/me`. Refresh and logout use the browser cookie set by login.

Validate the User & Team spec from the monorepo root with `npx --yes @redocly/cli@2 lint --extends spec contracts/openapi/user-team.yaml`.

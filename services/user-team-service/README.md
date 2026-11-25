# User & Team Service

This service will manage authentication, user accounts, teams, memberships, ownership, leadership, and invitations.

Implementation setup, API details, events, environment variables, tests, and operating instructions will be added after the service workspace is configured.

## Password authentication

See the [User & Team OpenAPI contract](../../contracts/openapi/user-team.yaml) for the full request, response, and authentication details.

Set `JWT_SECRET` in your local environment before testing login. Generate a random value with `openssl rand -hex 32`. Compose reads it from `infra/compose/.env`.

| Endpoint | Request | Success |
| --- | --- | --- |
| `POST /auth/signup` | JSON with `username`, `email`, `password`, and optional `displayName` | `201` with `{ "user": { "id": "...", "username": "...", "email": "...", "displayName": null } }` |
| `POST /auth/login` | JSON with `email` and `password` | `200` with `{ "accessToken": "..." }` and a `refreshToken` cookie |
| `GET /users/me` | `Authorization: Bearer <accessToken>` | `200` with the same public user envelope as signup |
| `POST /auth/refresh` | Trusted `Origin` and current `refreshToken` cookie | `200` with a fresh access token and replacement refresh cookie |
| `POST /auth/logout` | Trusted `Origin` and current `refreshToken` cookie | `204`, with the session revoked and the cookie cleared |

Email addresses are trimmed and lowercased. Signup requires at least eight characters and rejects passwords above bcrypt's 72-byte limit. Access tokens last 15 minutes. The Secure, HttpOnly refresh cookie lasts seven days, and a successful refresh starts a replacement seven-day session. Previously issued access tokens remain valid until they expire.

Use `credentials: 'include'` for browser requests to login, refresh, and logout. Set `AUTH_TRUSTED_ORIGINS` to a comma-separated list of exact frontend origins, including scheme and port when applicable. For local Compose, the defaults allow `http://localhost:5173` and `http://127.0.0.1:5173`. Keep the same loopback hostname in the frontend and API URLs during local testing. Refresh and logout reject missing or untrusted origins with `403` and invalid or revoked refresh cookies with `401`.

The direct service uses `AUTH_REFRESH_COOKIE_PATH=/auth` and `AUTH_REFRESH_COOKIE_SAME_SITE=lax`. Set the path to `/api/auth` when the public gateway adds that prefix. For a cross-site frontend/API deployment, use HTTPS, set `AUTH_REFRESH_COOKIE_SAME_SITE=none`, and allow only the actual trusted frontend origins. Verify cookie behavior on the deployed origins because browser policies can restrict cross-site cookies.

## Google sign-in

Create a Google OAuth client for a web application and register the exact `GOOGLE_REDIRECT_URI`. For direct local testing that is `http://localhost:3001/auth/google/callback`. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GOOGLE_SIGN_IN_SUCCESS_URL` in the ignored environment file for the way you are running the service. The success URL must use an origin in `AUTH_TRUSTED_ORIGINS`. When using a gateway, match the public callback path to `AUTH_REFRESH_COOKIE_PATH`.

Start by navigating the browser to `GET /auth/google`. Google returns to the API callback, which sets the refresh cookie and redirects to the configured frontend callback without putting a Teamisty token in the URL. The frontend callback should send `POST /auth/refresh` with credentials to obtain its first access token. That frontend screen is part of the web app work.

Accounts already linked to Google sign in by their verified Google subject. If the email matches an existing unlinked Teamisty account, first sign in to that account and then navigate to `GET /auth/google?link=1` to link it. The confirmed Google email must match the account and the Teamisty session must still be active at callback time.

New Google accounts get a username based on the Google display name, such as `nika-chhun`. If that name is taken, Teamisty tries numbered suffixes such as `nika-chhun-2`. If no usable name is available, it generates a `member-` username with a short suffix. Returning and linked accounts keep their existing usernames.

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

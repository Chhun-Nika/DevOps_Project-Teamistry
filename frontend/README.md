# Frontend

This directory will contain the Teamisty React/Vite web application.

Frontend responsibilities, setup instructions, environment variables, routes, and test commands will be documented here before implementation starts.

## Local container verification

Build from the monorepo root so npm workspace files are available:

```bash
docker build \
  --file frontend/Dockerfile \
  --tag teamisty/frontend:local \
  .
```

Run the Vite development container and open the application:

```bash
docker run --rm --publish 5173:5173 teamisty/frontend:local
```

Browse to `http://localhost:5173`.

# syntax=docker/dockerfile:1

FROM node:26-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Copy dependency manifests first so this installation layer is reused when
# application source code changes.
COPY package.json package-lock.json ./
COPY services/task-service/package.json ./services/task-service/package.json

RUN npm ci --workspace=@teamisty/task-service --include-workspace-root

COPY services/task-service ./services/task-service

# Client generation validates a connection URL but does not connect. Runtime
# Compose credentials are injected only when the container starts.
RUN DATABASE_URL=postgresql://localhost:5432/task_db npm run prisma:generate --workspace=@teamisty/task-service

RUN npm run build --workspace=@teamisty/task-service

FROM node:26-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3002

WORKDIR /app

COPY package.json package-lock.json ./
COPY services/task-service/package.json ./services/task-service/package.json

# Keep the runtime image small: install only this service's production
# dependencies. Prisma is a production dependency because migrations are run
# as a one-off Compose command against the private database.
RUN npm ci --omit=dev --workspace=@teamisty/task-service --include-workspace-root \
  && mkdir -p node_modules/.bin \
  && ln -s ../services/task-service/node_modules/prisma node_modules/prisma \
  && ln -s ../../services/task-service/node_modules/.bin/prisma node_modules/.bin/prisma

COPY --from=build /workspace/services/task-service/package.json ./package.json
COPY --from=build /workspace/services/task-service/prisma ./prisma
COPY --from=build /workspace/services/task-service/prisma.config.ts ./prisma.config.ts
COPY --from=build /workspace/services/task-service/dist ./dist

USER node

EXPOSE 3002

CMD ["node", "dist/server.js"]

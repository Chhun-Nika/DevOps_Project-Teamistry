# syntax=docker/dockerfile:1

FROM node:26-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Copy dependency manifests first so this installation layer is reused when
# application source code changes.
COPY package.json package-lock.json ./
COPY services/notification-service/package.json ./services/notification-service/package.json

RUN npm ci --workspace=@teamisty/notification-service --include-workspace-root

COPY services/notification-service ./services/notification-service

RUN DATABASE_URL=postgresql://localhost:5432/notification_db npm run prisma:generate --workspace=@teamisty/notification-service

RUN npm run build --workspace=@teamisty/notification-service

FROM node:26-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3003

WORKDIR /app

COPY package.json package-lock.json ./
COPY services/notification-service/package.json ./services/notification-service/package.json
RUN npm ci --omit=dev --workspace=@teamisty/notification-service --include-workspace-root \
  && mkdir -p node_modules/.bin \
  && ln -s ../services/notification-service/node_modules/prisma node_modules/prisma \
  && ln -s ../../services/notification-service/node_modules/.bin/prisma node_modules/.bin/prisma
COPY --from=build /workspace/services/notification-service/package.json ./package.json
COPY --from=build /workspace/services/notification-service/prisma ./prisma
COPY --from=build /workspace/services/notification-service/prisma.config.ts ./prisma.config.ts
COPY --from=build /workspace/services/notification-service/dist ./dist

USER node

EXPOSE 3003

CMD ["node", "dist/server.js"]

# syntax=docker/dockerfile:1

FROM node:26-bookworm-slim AS build

WORKDIR /workspace

# Copy dependency manifests first so this installation layer is reused when
# application source code changes.
COPY package.json package-lock.json ./
COPY services/notification-service/package.json ./services/notification-service/package.json

RUN npm ci --workspace=@teamisty/notification-service --include-workspace-root

COPY services/notification-service ./services/notification-service

RUN npm run build --workspace=@teamisty/notification-service

FROM node:26-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3003

WORKDIR /app

COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/services/notification-service/package.json ./package.json
COPY --from=build /workspace/services/notification-service/dist ./dist

USER node

EXPOSE 3003

CMD ["node", "dist/server.js"]

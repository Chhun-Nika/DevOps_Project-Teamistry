# syntax=docker/dockerfile:1

FROM node:26-bookworm-slim AS build

WORKDIR /workspace

# Copy dependency manifests first so this installation layer is reused when
# application source code changes.
COPY package.json package-lock.json ./
COPY services/task-service/package.json ./services/task-service/package.json

RUN npm ci --workspace=@teamisty/task-service --include-workspace-root

COPY services/task-service ./services/task-service

RUN npm run build --workspace=@teamisty/task-service

FROM node:26-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3002

WORKDIR /app

COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/services/task-service/package.json ./package.json
COPY --from=build /workspace/services/task-service/dist ./dist

USER node

EXPOSE 3002

CMD ["node", "dist/server.js"]

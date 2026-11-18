# syntax=docker/dockerfile:1

FROM node:26-bookworm-slim AS build

WORKDIR /workspace

# Copy only dependency manifests first so Docker can reuse this layer when
# application source code changes.
COPY package.json package-lock.json ./
COPY services/user-team-service/package.json ./services/user-team-service/package.json

RUN npm ci --workspace=@teamisty/user-team-service --include-workspace-root

COPY services/user-team-service ./services/user-team-service

RUN npm run build --workspace=@teamisty/user-team-service

FROM node:26-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/services/user-team-service/package.json ./package.json
COPY --from=build /workspace/services/user-team-service/dist ./dist

USER node

EXPOSE 3001

CMD ["node", "dist/server.js"]

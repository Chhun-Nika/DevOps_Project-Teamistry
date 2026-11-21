# syntax=docker/dockerfile:1

FROM node:26-bookworm-slim AS base

# Prisma Migrate needs the OpenSSL libraries provided by Debian.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS build

WORKDIR /workspace

# Copy only dependency manifests first so Docker can reuse this layer when
# application source code changes.
COPY package.json package-lock.json ./
COPY services/user-team-service/package.json ./services/user-team-service/package.json

RUN npm ci --workspace=@teamisty/user-team-service --include-workspace-root

COPY services/user-team-service ./services/user-team-service

RUN npm run build --workspace=@teamisty/user-team-service \
  && mkdir -p services/user-team-service/node_modules

FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app/services/user-team-service

# Preserve npm's root and workspace dependency layout for Prisma CLI and Client.
COPY --from=build /workspace/node_modules /app/node_modules
COPY --from=build /workspace/services/user-team-service/node_modules ./node_modules
COPY --from=build /workspace/services/user-team-service/package.json ./package.json
COPY --from=build /workspace/services/user-team-service/prisma.config.ts ./prisma.config.ts
COPY --from=build /workspace/services/user-team-service/prisma ./prisma
COPY --from=build /workspace/services/user-team-service/dist ./dist

USER node

EXPOSE 3001

CMD ["node", "dist/server.js"]

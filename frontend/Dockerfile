# syntax=docker/dockerfile:1

FROM node:26-bookworm-slim AS build

WORKDIR /workspace

# Copy dependency manifests first so Docker can reuse this layer when
# frontend source code changes.
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json

# The explicit optional dependencies cover the Linux-native bindings used by
# Vite and Tailwind on both supported container architectures.
RUN npm ci --workspace=@teamisty/frontend --include-workspace-root --include=optional

COPY frontend ./frontend

# Verify that the frontend can produce a production build before serving it
# through the local development container.
RUN npm run build --workspace=@teamisty/frontend

FROM node:26-bookworm-slim AS development

ENV NODE_ENV=development

WORKDIR /app

COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/frontend ./frontend

WORKDIR /app/frontend

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

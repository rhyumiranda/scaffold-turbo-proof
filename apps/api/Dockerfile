# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f apps/api/Dockerfile --target runtime .
# Every stage starts from the same digest-pinned base image; Dependabot's docker ecosystem proposes digest updates.
# Stages repeat the same setup lines instead of inheriting from a named stage, so every FROM line carries the digest.
# Identical instructions on the same base share one build-cache layer, so the repetition costs no build time.
FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS pruner
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Corepack verifies the pinned pnpm release and runs no install scripts. `npm install --global --ignore-scripts pnpm`
# leaves pnpm 12 as a non-executable placeholder, and turbo then fails to spawn it with "Exec format error".
RUN corepack enable pnpm && corepack prepare pnpm@12.15.0 --activate && npm install --global --ignore-scripts turbo@2.11.10
WORKDIR /repo
COPY . .
RUN turbo prune @repo/api --docker

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS builder
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm && corepack prepare pnpm@12.15.0 --activate && npm install --global --ignore-scripts turbo@2.11.10
WORKDIR /repo
COPY package.json pnpm-workspace.yaml ./
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ ./
RUN turbo run build --filter=@repo/api
RUN pnpm --filter @repo/api deploy --prod /runtime/api \
  && find /runtime/api/node_modules -type f \( -name '*.ts' ! -name '*.d.ts' -o -name '*.map' \) -delete

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS migrate
# The runtime needs only node: remove the bundled package managers (smaller image, and their own dependencies
# carry CVEs that the application never uses).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production
WORKDIR /app
# Files stay owned by root, so the runtime user can read but never modify code or dependencies.
COPY --from=builder /runtime/api/ ./
COPY --from=builder /repo/apps/api/dist-does-not-exist ./dist
USER node
COPY --from=builder /repo/apps/api/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder /repo/apps/api/migrations ./migrations
CMD ["node", "scripts/migrate.mjs"]

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS runtime
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /runtime/api/ ./
COPY --from=builder /repo/apps/api/dist ./dist
USER node
EXPOSE 4100
CMD ["node", "dist/main.js"]

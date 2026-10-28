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
# The build runs `prisma generate` (typecheck and build scripts); the generated client compiles into dist/.
RUN turbo run build --filter=@repo/api
# Runtime: production dependencies without the Prisma CLI (an optional dependency). The client keeps only the
# PostgreSQL query compiler the generated client loads (compilerBuild "fast"); other databases' builds are removed.
RUN pnpm --filter @repo/api deploy --prod --no-optional /runtime/api \
  && find /runtime/api/node_modules -type f \( -name '*.ts' ! -name '*.d.ts' -o -name '*.map' \) -delete \
  && find /runtime/api/node_modules/.pnpm -path '*/@prisma/client/runtime/*' -type f \
    \( -name '*small_bg*' -o -name '*.mysql.*' -o -name '*.sqlite.*' -o -name '*.sqlserver.*' -o -name '*.cockroachdb.*' \) \
    -delete
# Migrate: only what `prisma migrate deploy` and the history check need (scripts/migrate-bundle.mjs explains),
# plus the schema engine for this platform. Install scripts stay disabled, so the engine is fetched explicitly
# (`prisma --version`, checksum-verified by Prisma) and moved to a fixed path that the image names.
RUN pnpm --filter @repo/api deploy --prod /runtime/full \
  && node apps/api/scripts/migrate-bundle.mjs /runtime/full /runtime/migrate \
  && rm -rf /runtime/full \
  && cd /runtime/migrate \
  && CHECKPOINT_DISABLE=1 node node_modules/prisma/build/index.js --version \
  && find node_modules/.pnpm -path '*/@prisma/engines/schema-engine-*' -type f -exec mv {} /runtime/migrate/prisma-schema-engine \; \
  && find /runtime/migrate/node_modules -type f \( -name '*.ts' ! -name '*.d.ts' -o -name '*.map' \) -delete \
  && test -x /runtime/migrate/prisma-schema-engine

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS migrate
# The runtime needs only node: remove the bundled package managers (smaller image, and their own dependencies
# carry CVEs that the application never uses).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
# The job never downloads anything: the schema engine is in the image, update checks and jiti's disk cache are off
# (the root filesystem is read-only).
ENV NODE_ENV=production \
  PRISMA_SCHEMA_ENGINE_BINARY=/app/prisma-schema-engine \
  CHECKPOINT_DISABLE=1 \
  PRISMA_HIDE_UPDATE_MESSAGE=1 \
  JITI_FS_CACHE=false
WORKDIR /app
# Files stay owned by root, so the runtime user can read but never modify code or dependencies.
COPY --from=builder /runtime/migrate/ ./
COPY --from=builder /repo/apps/api/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder /repo/apps/api/prisma ./prisma
# The same config file as the repository, as .mjs: it is plain JavaScript, and the image carries no TypeScript.
COPY --from=builder /repo/apps/api/prisma.config.ts ./prisma.config.mjs
USER node
# `prisma migrate deploy`, after the edited-history check (scripts/migrate.mjs). Requires DATABASE_URL.
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

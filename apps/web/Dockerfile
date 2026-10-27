# syntax=docker/dockerfile:1
# Build from the repository root. Pass the Server Action key as a BuildKit secret, never a build arg:
#   docker build -f apps/web/Dockerfile --secret id=next_action_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY \
#     --build-arg APP_DEPLOYMENT_ID=<release> --build-arg DEPLOYMENT_REPLICAS=<n> .
# Next.js embeds that key in the server bundle, so treat the web image as secret-bearing (see docs/operations.md).
FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS tools
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Corepack verifies the pinned pnpm release and runs no install scripts (see apps/api/Dockerfile).
RUN corepack enable pnpm && corepack prepare pnpm@12.15.0 --activate && npm install --global --ignore-scripts turbo@2.11.10
WORKDIR /repo

FROM tools AS pruner
COPY . .
RUN turbo prune @repo/web --docker

FROM tools AS builder
COPY package.json pnpm-workspace.yaml ./
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ ./
ARG APP_DEPLOYMENT_ID
ARG DEPLOYMENT_REPLICAS=1
RUN --mount=type=secret,id=next_action_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY \
  turbo run build --filter=@repo/web

FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS runtime
# The runtime needs only node: remove the bundled package managers (smaller image, and their own dependencies
# carry CVEs that the application never uses).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
# Files stay owned by root, so the runtime user can read but never modify the server bundle.
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/scripts/container-start.mjs /repo/apps/web/scripts/runtime-config.mjs ./apps/web/scripts/
USER node
EXPOSE 3000
CMD ["node", "apps/web/scripts/container-start.mjs"]

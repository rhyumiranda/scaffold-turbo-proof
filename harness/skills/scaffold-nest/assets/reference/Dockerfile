FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci
COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# `prisma generate` runs inside the build script; the generated client compiles into dist/.
RUN npm run build
# Install scripts stay disabled (.npmrc), so the schema engine for this platform is fetched explicitly
# (`prisma --version`, checksum-verified by Prisma) and moved to a fixed path that the migrate image names.
RUN CHECKPOINT_DISABLE=1 node node_modules/prisma/build/index.js --version \
  && find node_modules/@prisma/engines -maxdepth 1 -name 'schema-engine-*' -type f -exec mv {} /app/prisma-schema-engine \; \
  && test -x /app/prisma-schema-engine
# Migrate job: production dependencies including the Prisma CLI (an optional dependency).
RUN npm prune --omit=dev
FROM node:24.22.1-bookworm-slim AS migrate
ENV NODE_ENV=production PRISMA_SCHEMA_ENGINE_BINARY=/app/prisma-schema-engine CHECKPOINT_DISABLE=1 \
  PRISMA_HIDE_UPDATE_MESSAGE=1 JITI_FS_CACHE=false
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/prisma-schema-engine ./prisma-schema-engine
COPY --chown=node:node scripts/migrate.mjs ./scripts/migrate.mjs
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node prisma.config.ts ./prisma.config.mjs
USER node
CMD ["node", "scripts/migrate.mjs"]
FROM build AS runtime-deps
# The API process never runs the Prisma CLI: drop it with the other optional dependencies.
RUN npm prune --omit=dev --omit=optional
FROM node:24.22.1-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=runtime-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
CMD ["node", "dist/main.js"]

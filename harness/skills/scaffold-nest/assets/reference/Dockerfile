FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev
FROM node:24.22.1-bookworm-slim AS runtime-base
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
FROM runtime-base AS migrate
COPY --chown=node:node scripts/migrate.mjs ./scripts/migrate.mjs
COPY --chown=node:node migrations ./migrations
CMD ["node", "scripts/migrate.mjs"]
FROM runtime-base AS runtime
CMD ["node", "dist/main.js"]

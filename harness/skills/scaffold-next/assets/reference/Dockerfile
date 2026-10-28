FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:24.22.1-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/scripts/container-start.mjs /app/scripts/runtime-config.mjs ./scripts/
USER node
CMD ["node", "scripts/container-start.mjs"]

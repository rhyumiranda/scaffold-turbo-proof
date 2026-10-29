// Prisma CLI configuration (generate, migrate deploy, migrate diff). Plain JavaScript syntax on purpose:
// the migrate image runs this same file as prisma.config.mjs, so the image carries no TypeScript sources.
import { defineConfig } from 'prisma/config';

export default defineConfig({
  // Multi-file schema: base.prisma (generator, datasource) plus one folder per API module.
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  // Runtime-only CLI commands use the real database. Builds use prisma.generate.config.ts, whose empty URL keeps
  // DATABASE_URL out of the cache key because client generation does not connect to a database.
  // scripts/migrate.mjs refuses to start without DATABASE_URL before Prisma reads this file.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});

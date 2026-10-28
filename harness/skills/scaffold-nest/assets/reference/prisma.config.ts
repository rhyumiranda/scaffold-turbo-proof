// Prisma CLI configuration (generate, migrate deploy, migrate diff). Plain JavaScript syntax on purpose:
// the migrate image runs this same file as prisma.config.mjs, so the image carries no TypeScript sources.
import { defineConfig } from 'prisma/config';

export default defineConfig({
  // Multi-file schema: base.prisma (generator, datasource) plus one folder per API module.
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  // process.env, not env(): `prisma generate` runs during builds without a database.
  // scripts/migrate.mjs refuses to start without DATABASE_URL before Prisma reads this.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});

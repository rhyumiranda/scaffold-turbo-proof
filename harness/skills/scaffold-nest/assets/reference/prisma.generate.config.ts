// Build-only Prisma configuration. Client generation reads schema files but never connects to a database, so using
// a fixed empty URL keeps runtime DATABASE_URL changes from invalidating otherwise identical build artifacts.
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: '' },
});

import { cp } from 'node:fs/promises';
import { startServer } from './runtime-config.mjs';

await cp(
  new URL('../.next/static/', import.meta.url),
  new URL('../.next/standalone/apps/web/.next/static/', import.meta.url),
  { recursive: true },
);
await startServer(new URL('../.next/standalone/apps/web/server.js', import.meta.url).href);

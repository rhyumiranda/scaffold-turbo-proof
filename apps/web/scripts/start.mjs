import { cp } from 'node:fs/promises';
import { validateRuntime } from './runtime-config.mjs';

validateRuntime();
await cp(
  new URL('../.next/static/', import.meta.url),
  new URL('../.next/standalone/apps/web/.next/static/', import.meta.url),
  { recursive: true },
);
await import('../.next/standalone/apps/web/server.js');

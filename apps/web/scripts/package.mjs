import { cp } from 'node:fs/promises';
// Prepare once during artifact creation, never mutate shared files when replicas start. In the workspace the
// standalone server lives under apps/web, so its static files go next to it there.
await cp(
  new URL('../.next/static/', import.meta.url),
  new URL('../.next/standalone/apps/web/.next/static/', import.meta.url),
  { recursive: true },
);

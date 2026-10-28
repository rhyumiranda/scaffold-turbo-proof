import { cp } from 'node:fs/promises';
// Prepare once during artifact creation, never mutate shared files when replicas start.
await cp(new URL('../.next/static/', import.meta.url), new URL('../.next/standalone/.next/static/', import.meta.url), {
  recursive: true,
});

import { startServer } from './runtime-config.mjs';
await startServer(new URL('../.next/standalone/server.js', import.meta.url).href);

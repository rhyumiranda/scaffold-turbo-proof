import { startServer } from './runtime-config.mjs';
await startServer(new URL('../server.js', import.meta.url).href);

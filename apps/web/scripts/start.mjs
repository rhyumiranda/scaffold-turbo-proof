import { startServer } from './runtime-config.mjs';
// In the workspace, Next.js nests the standalone server under the app's path from the repository root.
await startServer(new URL('../.next/standalone/apps/web/server.js', import.meta.url).href);

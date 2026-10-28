import { createServer } from 'node:http';
import { installShutdown } from '../../dist/platform/shutdown.js';
const server = createServer(async (_request, response) => {
  console.log('request.started');
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.WORK_MS)));
  response.end('completed');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
installShutdown(server, async () => {}, Number(process.env.SHUTDOWN_TIMEOUT_MS));
console.log(JSON.stringify({ port: server.address().port }));

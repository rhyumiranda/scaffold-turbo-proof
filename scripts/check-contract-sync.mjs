import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

const api = JSON.parse(await readFile(new URL('../apps/api/openapi.json', import.meta.url), 'utf8'));
const client = JSON.parse(
  await readFile(new URL('../packages/api-client/contract/openapi.json', import.meta.url), 'utf8'),
);
if (!isDeepStrictEqual(api, client))
  throw new Error('API/client schema drift: run pnpm contract:generate and review the change.');
console.log('API and client schemas agree.');

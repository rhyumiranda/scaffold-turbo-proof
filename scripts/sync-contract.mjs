import { copyFile } from 'node:fs/promises';

await copyFile(
  new URL('../apps/api/openapi.json', import.meta.url),
  new URL('../packages/api-client/contract/openapi.json', import.meta.url),
);
console.log('Synchronized the reviewed API schema into @repo/api-client.');

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
export function evaluateBudget(gzipBytes, budget) {
  if (!Number.isInteger(budget.maxClientJavascriptGzipBytes) || budget.maxClientJavascriptGzipBytes <= 0)
    throw new Error('Invalid client JavaScript budget');
  if (gzipBytes > budget.maxClientJavascriptGzipBytes)
    throw new Error(
      `Client JavaScript ${gzipBytes} gzip bytes exceeds ${budget.maxClientJavascriptGzipBytes}. Inspect chunks; change the budget only with a documented measured reason.`,
    );
  return { gzipBytes, limit: budget.maxClientJavascriptGzipBytes };
}
function clientReferenceManifests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const path = join(directory, item.name);
    if (item.isDirectory()) return clientReferenceManifests(path);
    return item.name.endsWith('_client-reference-manifest.js') ? [path] : [];
  });
}
export function currentClientFiles(nextDirectory = '.next') {
  const manifests = [
    join(nextDirectory, 'build-manifest.json'),
    ...clientReferenceManifests(join(nextDirectory, 'server', 'app')),
  ];
  const files = new Set();
  for (const manifest of manifests) {
    for (const match of readFileSync(manifest, 'utf8').matchAll(/static\/chunks\/[^"' ]+?\.js/g)) {
      files.add(decodeURIComponent(match[0]));
    }
  }
  return [...files].sort();
}
export function currentClientSize(nextDirectory = '.next') {
  return currentClientFiles(nextDirectory).reduce(
    (total, file) => total + gzipSync(readFileSync(join(nextDirectory, file))).length,
    0,
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = evaluateBudget(currentClientSize(), JSON.parse(readFileSync('performance-budget.json', 'utf8')));
  console.log(JSON.stringify({ check: 'current-client-chunks-gzip', ...result }));
}

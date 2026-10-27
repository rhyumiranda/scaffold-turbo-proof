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
function size(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce(
    (total, item) =>
      total +
      (item.isDirectory()
        ? size(join(directory, item.name))
        : item.name.endsWith('.js')
          ? gzipSync(readFileSync(join(directory, item.name))).length
          : 0),
    0,
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = evaluateBudget(
    size('.next/static/chunks'),
    JSON.parse(readFileSync('performance-budget.json', 'utf8')),
  );
  console.log(JSON.stringify({ check: 'all-client-chunks-gzip', ...result }));
}

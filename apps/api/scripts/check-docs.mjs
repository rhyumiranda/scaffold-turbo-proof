import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const files = ['AGENTS.md'];
function walk(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) walk(path);
    else if (item.name.endsWith('.md')) files.push(path);
  }
}
walk('docs');
const failures = [];
for (const file of files)
  for (const match of readFileSync(file, 'utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1];
    if (/^(https?:|#)/.test(href)) continue;
    if (!existsSync(resolve(dirname(file), href.split('#')[0]))) failures.push(`${file}: missing ${href}`);
  }
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`Documentation links passed (${files.length} documents).`);

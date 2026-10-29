// Print build-time environment keys read by an entry file or any local module it imports.
// ProcessEnv parameters cover helpers such as deploymentSettings(env = process.env).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

const pending = process.argv.slice(2).map((file) => resolve(file));
const seen = new Set();
const keys = new Set();

function localModule(from, specifier) {
  if (!specifier.startsWith('.')) return;
  const base = resolve(dirname(from), specifier);
  const candidates = extname(base)
    ? [base]
    : [base + '.ts', base + '.mts', base + '.js', base + '.mjs', resolve(base, 'index.ts'), resolve(base, 'index.mjs')];
  return candidates.find(existsSync);
}

while (pending.length) {
  const file = pending.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bprocess\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g))
    keys.add(match[1] ?? match[2]);
  for (const parameter of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*(?:NodeJS\.)?ProcessEnv\b/g)) {
    const alias = parameter[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const match of source.matchAll(new RegExp(`\\b${alias}(?:\\.([A-Z][A-Z0-9_]*)|\\[['"]([A-Z][A-Z0-9_]*)['"]\\])`, 'g')))
      keys.add(match[1] ?? match[2]);
  }
  for (const match of source.matchAll(/\b(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
    const imported = localModule(file, match[1]);
    if (imported) pending.push(imported);
  }
}

console.log([...keys].sort().join('\n'));

// Collects every per-criterion verdict into one table and results.json. Criteria with no verdict are listed as MISSING.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
const dir = join(root, 'results');
const results = existsSync(dir)
  ? readdirSync(dir).filter((f) => /^AC-\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  : [];
const byAc = new Map(results.map((r) => [r.ac, r]));
const rows = [];
for (let n = 1; n <= 107; n++) {
  const ac = `AC-${String(n).padStart(2, '0')}`;
  rows.push(byAc.get(ac) ?? { ac, result: 'MISSING', reason: 'no verdict produced', job: '-' });
}
writeFileSync(join(root, 'results.json'), JSON.stringify(rows, null, 2));
const count = rows.reduce((m, r) => ((m[r.result] = (m[r.result] ?? 0) + 1), m), {});
console.log(`## Acceptance results\n\n${Object.entries(count).map(([k, v]) => `${k}: ${v}`).join(' · ')}\n`);
console.log('| AC | Result | Job | Reason |\n|---|---|---|---|');
for (const r of rows) console.log(`| ${r.ac} | ${r.result} | ${r.job} | ${String(r.reason).replace(/\|/g, '/')} |`);

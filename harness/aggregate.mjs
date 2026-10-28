// Collects every per-criterion verdict into one table and results.json. Criteria with no verdict are listed as MISSING.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
const dir = join(root, 'results');
const results = existsSync(dir)
  ? readdirSync(dir).filter((f) => /^AC-\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  : [];
const byAc = new Map(results.map((r) => [r.ac, r]));
// Criteria split across jobs: TARGET.json "parts" names the shards each needs (results/parts/<AC>-<shard>.json).
// The criterion passes only when every named shard ran and passed; a missing shard is a FAIL.
const target = JSON.parse(readFileSync(new URL('./TARGET.json', import.meta.url), 'utf8'));
for (const [ac, shards] of Object.entries(target.parts ?? {})) {
  const parts = shards.map((shard) => {
    const file = join(dir, 'parts', `${ac}-${shard}.json`);
    return existsSync(file) ? { shard, ...JSON.parse(readFileSync(file, 'utf8')) } : { shard, result: 'MISSING', reason: 'shard produced no result' };
  });
  const failed = parts.filter((part) => part.result !== 'PASS');
  byAc.set(ac, {
    ac,
    result: failed.length ? 'FAIL' : 'PASS',
    reason: parts.map((part) => `${part.shard}: ${part.result} (${part.reason})`).join('; '),
    job: shards.join('+'),
    commit: parts[0].commit ?? '',
    skillTree: parts[0].skillTree ?? '',
  });
}
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

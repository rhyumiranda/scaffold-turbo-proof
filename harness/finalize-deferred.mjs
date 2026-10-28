// Run after harness/aggregate.mjs inputs are merged: node harness/finalize-deferred.mjs <dir containing results/>
// AC-97..AC-107 are DEFERRED by deferred.sh only if their own local checks pass; the prerequisite criteria are graded by
// other jobs, so this step downgrades a deferred verdict to FAIL when a named prerequisite is not PASS.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const dir = join(process.argv[2], 'results');
const read = (ac) => { const p = join(dir, ac + '.json'); return existsSync(p) ? [p, JSON.parse(readFileSync(p, 'utf8'))] : [null, null]; };
for (let n = 97; n <= 107; n++) {
  const ac = 'AC-' + n; const [p, r] = read(ac);
  if (!r || r.result !== 'DEFERRED' || !Array.isArray(r.prerequisites)) continue;
  const notPass = r.prerequisites.filter((q) => { const [, x] = read(q); return !x || !['PASS', 'PASS-WITH-PATCH'].includes(x.result); });
  if (notPass.length) { r.result = 'FAIL'; r.reason = `local prerequisite not met: ${notPass.join(', ')}. ` + r.reason; }
  else r.reason += ' All named prerequisite criteria are PASS in this run.';
  writeFileSync(p, JSON.stringify(r, null, 2));
  console.log(ac, r.result, r.reason);
}

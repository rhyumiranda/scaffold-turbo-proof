'use strict';
// Reads the three Lighthouse JSON reports, writes redacted copies and a summary, and asserts the AC-70 thresholds on the medians.
const fs = require('node:fs');
const path = require('node:path');
const [dir, outDir] = process.argv.slice(2);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const rows = [];
for (const n of [1, 2, 3]) {
  const file = path.join(dir, `run${n}.json`);
  if (!fs.existsSync(file)) { rows.push({ n, error: 'report missing' }); continue; }
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (r.configSettings) delete r.configSettings.extraHeaders; // the session cookie
  fs.writeFileSync(path.join(outDir, `lighthouse-run${n}.redacted.json`), JSON.stringify(r));
  const a = r.audits;
  const scripts = (a['network-requests']?.details?.items || []).filter((i) => i.resourceType === 'Script').reduce((s, i) => s + (i.transferSize || 0), 0);
  rows.push({
    n, finalUrl: r.finalDisplayedUrl || r.finalUrl, formFactor: r.configSettings?.formFactor, throttlingMethod: r.configSettings?.throttlingMethod, version: r.lighthouseVersion,
    lcp: a['largest-contentful-paint']?.numericValue, cls: a['cumulative-layout-shift']?.numericValue, tbt: a['total-blocking-time']?.numericValue, scripts, warnings: r.runWarnings,
  });
}
const good = rows.filter((r) => !r.error);
const m = { lcp: median(good.map((r) => r.lcp)), cls: median(good.map((r) => r.cls)), tbt: median(good.map((r) => r.tbt)), scripts: median(good.map((r) => r.scripts)) };
const lines = rows.map((r) => (r.error ? `run${r.n}: ${r.error}` : `run${r.n}: finalUrl=${r.finalUrl} formFactor=${r.formFactor} throttling=${r.throttlingMethod} lighthouse=${r.version} LCP=${(r.lcp / 1000).toFixed(2)}s CLS=${r.cls.toFixed(3)} TBT=${Math.round(r.tbt)}ms scriptTransfer=${r.scripts}B warnings=${JSON.stringify(r.warnings)}`));
lines.push(`MEDIAN: LCP=${(m.lcp / 1000).toFixed(2)}s (<=2.5) CLS=${m.cls.toFixed(3)} (<=0.1) TBT=${Math.round(m.tbt)}ms (<=200) scripts=${m.scripts}B (<=250000)`);
const problems = [];
if (good.length !== 3) problems.push('fewer than 3 reports');
if (good.some((r) => !/\/projects$/.test(new URL(r.finalUrl).pathname))) problems.push('a run did not end on /projects');
if (good.some((r) => r.formFactor !== 'mobile')) problems.push('a run was not mobile emulation');
if (!(m.lcp <= 2500)) problems.push('median LCP above 2.5 s');
if (!(m.cls <= 0.1)) problems.push('median CLS above 0.1');
if (!(m.tbt <= 200)) problems.push('median TBT above 200 ms');
if (!(m.scripts <= 250000)) problems.push('scripts transferred above 250 KB');
lines.push(problems.length ? 'PROBLEMS: ' + problems.join('; ') : 'ALL LIGHTHOUSE THRESHOLDS MET');
fs.writeFileSync(path.join(outDir, 'lighthouse-summary.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
process.exit(problems.length ? 1 : 0);

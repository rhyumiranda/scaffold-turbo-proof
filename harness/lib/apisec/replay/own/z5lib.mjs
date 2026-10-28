// z5 own adversarial toolkit (round 2k). Raw TCP so every byte is under control.
import { chromium, kcLogin } from '../scripts/lib.mjs';
import { writeFileSync } from 'node:fs';
import net from 'node:net';
export const env = process.env, BASE = 'http://localhost:3103', out = env.OUT;
export async function capture() {
  const browser = await chromium.launch(); const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(BASE + '/auth/login'); await kcLogin(page, 'alice', env.ALICE_PASSWORD); await page.waitForURL(BASE + '/projects');
  const caps = {};
  page.on('request', (rq) => { const id = rq.headers()['next-action']; if (rq.method() === 'POST' && id && !caps[id]) caps[id] = { path: new URL(rq.url()).pathname, type: new URL(rq.url()).pathname.includes('/projects/') ? 'rename' : 'create', ct: rq.headers()['content-type'], body: rq.postData() }; });
  await page.getByLabel('Project name').fill('z5-seed'); await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('status').filter({ hasText: 'Project created.' }).waitFor();
  await page.getByRole('link', { name: 'Open created project' }).click(); await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  const pid = page.url().split('/').pop();
  await page.getByLabel('Project name').fill('z5-renamed'); await page.getByRole('button', { name: 'Save name' }).click();
  await page.getByRole('status').filter({ hasText: 'Project renamed.' }).waitFor();
  const cookie = (await ctx.cookies(BASE)).map((c) => c.name + '=' + c.value).join('; ');
  await browser.close();
  const createId = Object.keys(caps).find((k) => caps[k].type === 'create'), renameId = Object.keys(caps).find((k) => caps[k].type === 'rename');
  return { createId, renameId, pid, cookie, caps };
}
export function send(raw, { timeout = 8000, port = 3103, settle = 150, collect = false } = {}) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1'); let buf = Buffer.alloc(0); let done = false; const t0 = Date.now();
    const fin = (st) => { if (done) return; done = true; s.destroy(); const text = buf.toString('latin1'); const m = /^HTTP\/1\.[01] (\d{3})/.exec(text); const he = text.indexOf('\r\n\r\n'); resolve({ status: m ? Number(m[1]) : st, ms: Date.now() - t0, head: text.slice(0, he < 0 ? 400 : he).replace(/\r\n/g, ' | ').slice(0, 600), body: text.slice(he + 4, he + 4 + 300), raw: collect ? text : undefined }); };
    s.on('connect', () => s.write(raw)); s.on('data', (d) => { buf = Buffer.concat([buf, d]); if (/^HTTP\/1\.[01] \d{3}/.test(buf.toString('latin1', 0, 16)) && buf.includes('\r\n\r\n')) { clearTimeout(s._t); s._t = setTimeout(() => fin('ok'), settle); } });
    s.on('error', (e) => fin('socket-error ' + e.code)); s.on('close', () => fin(buf.length ? 'closed-after-data' : 'closed-no-response'));
    s.setTimeout(timeout, () => fin('timeout'));
  });
}
export class Tally {
  constructor(name, port = 3103) { this.name = name; this.rows = []; this.bad = []; this.hang = []; this.port = port; this.statuses = {}; }
  async run(label, rawOrBuf, opts = {}) {
    const res = await send(rawOrBuf, { port: this.port, ...opts });
    const row = { label, status: res.status, ms: res.ms, head: res.head.slice(0, 200), body: res.body.replace(/\s+/g, ' ').slice(0, 90) };
    this.rows.push(row); this.statuses[res.status] = (this.statuses[res.status] || 0) + 1;
    if (typeof res.status === 'number' && res.status >= 500) { this.bad.push(row); console.log('5XX', JSON.stringify(row)); }
    else if (res.status === 'timeout') { this.hang.push(row); console.log('HANG', JSON.stringify(row)); }
    return res;
  }
  done() { const s = { name: this.name, total: this.rows.length, fiveXX: this.bad.length, hangs: this.hang.length, byStatus: this.statuses }; console.log(JSON.stringify(s)); if (out) writeFileSync(`${out}/${this.name}.json`, JSON.stringify({ summary: s, bad: this.bad, hang: this.hang, rows: this.rows })); return s; }
}
export const crlf = (...l) => l.join('\r\n');
// builds a request. h: object of headers (null removes). body: string|Buffer
export function rq({ method = 'GET', target = '/', version = 'HTTP/1.1', h = {}, body = null, cl = true, raw = '' }) {
  const b = body === null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1');
  const hh = { Host: 'localhost:3103', ...h };
  if (cl && body !== null && hh['Content-Length'] === undefined) hh['Content-Length'] = String(b.length);
  for (const k of Object.keys(hh)) if (hh[k] === null) delete hh[k];
  const head = `${method} ${target} ${version}\r\n` + Object.entries(hh).map(([k, v]) => `${k}: ${v}`).join('\r\n') + (Object.keys(hh).length ? '\r\n' : '') + raw + '\r\n';
  return Buffer.concat([Buffer.from(head, 'latin1'), b]);
}

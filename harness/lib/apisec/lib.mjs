// Shared helpers for the apisec / oidc attack scripts. Pure Node built-ins plus packages resolved from the
// generated workspace (CLONE). Nothing here prints a secret; scripts record outcomes in OUT/assert.json.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const env = process.env;
export const CLONE = env.CLONE;
export const OUT = env.OUT || '.';
mkdirSync(OUT, { recursive: true });
export const KC = env.KC_URL || 'http://localhost:8080';
export const reqWeb = createRequire(CLONE + '/apps/web/package.json');
export const reqApi = createRequire(CLONE + '/apps/api/package.json');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sha = (s) => createHash('sha256').update(s).digest('hex');
export const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
export const decode = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
export const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;

// Assertion collector. Several invocations (phases) of one criterion append to the same OUT/assert.json.
export class Asserts {
  constructor(ac, file = OUT + '/assert.json') {
    this.file = file;
    const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    this.data = prev ?? { ac, checks: [], notes: {} };
  }
  check(label, ok, detail) {
    const row = { label, ok: !!ok, ...(detail === undefined ? {} : { detail }) };
    this.data.checks.push(row);
    console.log((row.ok ? 'PASS ' : 'FAIL ') + label + (detail === undefined ? '' : ' | ' + JSON.stringify(detail).slice(0, 300)));
    this.save();
    return row.ok;
  }
  note(key, value) { this.data.notes[key] = value; this.save(); }
  save() { writeFileSync(this.file, JSON.stringify(this.data, null, 1)); }
  finish() {
    this.save();
    const bad = this.data.checks.filter((c) => !c.ok);
    console.log(`SUMMARY ${this.data.checks.length - bad.length}/${this.data.checks.length} checks passed`);
    return bad.length === 0;
  }
}

export async function kcAdminToken() {
  const r = await fetch(KC + '/realms/master/protocol/openid-connect/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'admin', password: env.KC_ADMIN_PASSWORD }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('Keycloak admin login failed');
  return j.access_token;
}
export async function kcAdmin(method, path, body) {
  return fetch(KC + '/admin/realms' + path, { method, headers: { authorization: 'Bearer ' + (await kcAdminToken()), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
// Password-grant token for a real Keycloak user (never printed).
export async function mint({ realm = 'acme', client = 'acme-cli', secret = env.ACME_CLI_SECRET, user = 'alice', pass = env.ALICE_PASSWORD, scope = 'openid' } = {}) {
  const r = await fetch(`${KC}/realms/${realm}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: client, client_secret: secret, username: user, password: pass, scope }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`token mint failed for ${realm}/${client}/${user}: HTTP ${r.status} ${j.error ?? ''}`);
  return j.access_token;
}

// Read-only SQL through psql (SELECT only).
export function sql(db, q) {
  return execFileSync('psql', ['-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-d', db, '-Atc', q], { env: { ...env, PGPASSWORD: env.PG_PASSWORD }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}
export function rcli(port, ...args) {
  return execFileSync('redis-cli', ['-p', String(port), ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

// RFC 9457 shape + request identifier checks used by AC-31 / AC-36.
export function problemShape(res, text) {
  let j; try { j = JSON.parse(text); } catch {}
  const ct = (res.headers.get('content-type') || '').split(';')[0];
  const rid = res.headers.get('x-request-id');
  return {
    contentType: ct,
    isProblemJson: ct === 'application/problem+json',
    hasFields: !!j && typeof j.type === 'string' && typeof j.title === 'string' && j.status === res.status && typeof j.requestId === 'string' && j.requestId.length > 0,
    requestIdMatchesHeader: !!j && !!rid && j.requestId === rid,
    json: j,
  };
}
export const LEAK = /at .*\(|\.ts:|\.js:|SELECT|INSERT|node_modules|Error:/;

// Liveness poller: polls /health/live on each port every 200 ms until stop() is called.
export function livePoller(ports) {
  const rows = []; let on = true;
  const loop = (async () => {
    while (on) {
      for (const p of ports) {
        const t = Date.now();
        try { const r = await fetch(`http://127.0.0.1:${p}/health/live`, { signal: AbortSignal.timeout(5000) }); rows.push({ p, s: r.status, ms: Date.now() - t }); }
        catch (e) { rows.push({ p, s: 'ERR', ms: Date.now() - t, e: String(e.cause?.code || e.message) }); }
      }
      await sleep(200);
    }
  })();
  return { async stop() { on = false; await loop; return rows; } };
}
export const hist = (arr, f = (x) => x.status) => arr.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {});

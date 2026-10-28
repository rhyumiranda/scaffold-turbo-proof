'use strict';
// Shared helpers for the browser checks of AC-63 to AC-71. Every script records named checks and exits 1 when any fails.
// Configuration comes from environment variables (names only are recorded in evidence; passwords are never printed).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const WS = process.env.WS;
const resolveFromWeb = (name) => require(require.resolve(name, { paths: [path.join(WS, 'apps/web')] }));
const pw = resolveFromWeb('@playwright/test');
const AxeBuilder = resolveFromWeb('@axe-core/playwright').default;

const BASE = process.env.UX_BASE || 'http://localhost:3101';
const BASE_SHORT = process.env.UX_BASE_SHORT || 'http://localhost:3102';
const API = process.env.UX_API || 'http://127.0.0.1:4101';
const TOXI = process.env.UX_TOXI || 'http://127.0.0.1:8474';
const KC = process.env.UX_KC || 'http://localhost:8080';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const browsers = [];
async function launch(options) {
  const browser = await pw.chromium.launch(options);
  browsers.push(browser);
  return browser;
}
const checks = [];
function check(name, ok, detail) {
  const pass = Boolean(ok);
  checks.push({ name, ok: pass, detail: detail === undefined ? undefined : typeof detail === 'string' ? detail : JSON.stringify(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`);
  return pass;
}
const note = (text) => console.log('NOTE ' + text);

function evDir(ac) {
  const d = path.join(process.env.EV, ac);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// run('AC-64', async () => {...}): runs the body, records an exception as a failed check, writes the checks file, exits.
async function run(ac, body) {
  const script = path.basename(process.argv[1], '.cjs') + (process.argv[2] ? '-' + process.argv[2] : '');
  try {
    await body();
  } catch (error) {
    check('script finished without an exception', false, String((error && error.stack) || error).slice(0, 1500));
  } finally {
    try { await resetToxics(); } catch { /* proxy may be absent for scripts that do not use it */ }
    for (const browser of browsers) await browser.close().catch(() => {});
  }
  const ok = checks.length > 0 && checks.every((c) => c.ok);
  fs.writeFileSync(path.join(evDir(ac), script + '.checks.json'), JSON.stringify({ ok, failed: checks.filter((c) => !c.ok).map((c) => c.name), checks }, null, 1));
  console.log(`RESULT ${ac} ${script}: ${ok ? 'ALL CHECKS PASS' : 'FAILED: ' + checks.filter((c) => !c.ok).map((c) => c.name).join(' | ')} (${checks.length} checks)`);
  process.exit(ok ? 0 : 1);
}

async function seen(locator, timeout = 10000) {
  try { await locator.first().waitFor({ state: 'visible', timeout }); return true; } catch { return false; }
}

// Real sign-in through the Keycloak login form. Returns when the browser is back on the app origin.
async function login(page, user, password, base = BASE, start = '/auth/login') {
  await page.goto(base + start);
  if (!/\/realms\/acme\//.test(page.url())) {
    try { await page.waitForURL(/\/realms\/acme\//, { timeout: 15000 }); } catch { /* already signed in */ }
  }
  if (await page.locator('#username').count()) {
    await page.fill('#username', user);
    await page.fill('#password', password);
    await page.click('#kc-login');
  }
  await page.waitForURL((u) => u.origin === new URL(base).origin && !u.pathname.startsWith('/auth'), { timeout: 30000 });
}

async function apiToken(user, password) {
  const body = new URLSearchParams({ grant_type: 'password', client_id: 'acme-cli', client_secret: process.env.ACME_CLI_SECRET, username: user, password, scope: 'openid' });
  const r = await fetch(KC + '/realms/acme/protocol/openid-connect/token', { method: 'POST', body });
  if (!r.ok) throw new Error('token request failed: HTTP ' + r.status);
  return (await r.json()).access_token;
}
async function apiCreate(token, name) {
  const r = await fetch(API + '/v1/projects', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  if (r.status !== 201) throw new Error('create project: HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
async function apiPatch(token, id, name, expectedVersion) {
  const r = await fetch(API + '/v1/projects/' + id, { method: 'PATCH', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ name, expectedVersion }) });
  return r.status;
}
async function apiList(token, query = '') {
  const r = await fetch(API + '/v1/projects' + query, { headers: { authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('list projects: HTTP ' + r.status);
  return r.json();
}
// Makes sure the user owns at least `count` projects (created through the API; the UI is what is under test).
async function ensureProjects(token, count, prefix = 'Seed project ') {
  let have = (await apiList(token, '?limit=100')).length;
  for (; have < count; have++) await apiCreate(token, prefix + String(have).padStart(3, '0'));
  return (await apiList(token, '?limit=100')).length;
}

// Toxiproxy (web to API). enabled=false cuts the connection (outage).
async function toxi(enabled) {
  const r = await fetch(TOXI + '/proxies/web_api', { method: 'POST', body: JSON.stringify({ enabled }) });
  if (!r.ok) throw new Error('toxiproxy enable=' + enabled + ' failed: HTTP ' + r.status);
}
async function latency(ms) {
  await fetch(TOXI + '/proxies/web_api/toxics/lat', { method: 'DELETE' }).catch(() => {});
  if (ms) {
    const r = await fetch(TOXI + '/proxies/web_api/toxics', { method: 'POST', body: JSON.stringify({ name: 'lat', type: 'latency', stream: 'downstream', attributes: { latency: ms, jitter: 0 } }) });
    if (!r.ok) throw new Error('latency toxic failed: HTTP ' + r.status);
  }
}
async function resetToxics() {
  await toxi(true);
  await latency(0);
}

// ctl.sh restarts or stops the API and web processes (UX_CTL points at it).
function ctl(...args) {
  return execFileSync('bash', [process.env.UX_CTL, ...args], { encoding: 'utf8', timeout: 120000 });
}

// Layout-shift recorder installed before any page script runs.
const clsInit = () => {
  window.__cls = 0;
  window.__shifts = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__shifts.push({ v: e.value, t: e.startTime }); }
  }).observe({ type: 'layout-shift', buffered: true });
};

module.exports = {
  ...pw, launch, AxeBuilder, BASE, BASE_SHORT, API, TOXI, KC, TAGS, fs, path, check, note, run, seen, login, evDir,
  apiToken, apiCreate, apiPatch, apiList, ensureProjects, toxi, latency, resetToxics, ctl, clsInit,
};

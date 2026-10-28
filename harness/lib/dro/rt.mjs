// Shared helpers for the browser and HTTP scenario scripts of the data, resilience and observability jobs.
// Configuration comes from environment variable names only (values are never written to evidence):
//   WS (generated repo), WEB_URL (browser origin of the web app), API_URL (API origin, direct), KC_ISSUER,
//   KC_ACME_CLI_SECRET, KC_USER_PASSWORD, TOXI_URL, OUT (evidence directory for this criterion).
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';

const require = createRequire(process.env.WS + '/apps/web/package.json');
export const { chromium } = require('@playwright/test');
export const redisModule = () => require('@redis/client');
export const WEB = process.env.WEB_URL;
export const API = process.env.API_URL;
export const TOXI = process.env.TOXI_URL;
export const OUT = process.env.OUT;
if (OUT) mkdirSync(OUT, { recursive: true });

export const now = () => new Date().toISOString();
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Text that would show a stack trace or runtime internals to a user.
export const STACK = /\n\s+at\s|at [\w.<>]+ \(|node_modules|\.js:\d+:\d+|Error: [A-Za-z]|ECONN|ENOTFOUND/;

export async function token(user) {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'acme-cli',
    client_secret: process.env.KC_ACME_CLI_SECRET,
    username: user,
    password: process.env.KC_USER_PASSWORD,
    scope: 'openid',
  });
  const response = await fetch(process.env.KC_ISSUER + '/protocol/openid-connect/token', { method: 'POST', body });
  const json = await response.json();
  if (!json.access_token) throw new Error('token request failed: ' + response.status);
  return json.access_token;
}

// Real browser sign-in through the OIDC redirect to Keycloak and back.
export async function login(page, user, { returnPattern } = {}) {
  await page.goto(WEB + '/auth/login');
  await page.fill('#username', user);
  await page.fill('#password', process.env.KC_USER_PASSWORD);
  await page.click('#kc-login');
  await page.waitForURL(returnPattern ?? /\/projects/, { timeout: 30000 });
}

export async function apiCount(tok) {
  let total = 0;
  for (let offset = 0; ; offset += 100) {
    const response = await fetch(`${API}/v1/projects?limit=100&offset=${offset}`, { headers: { authorization: 'Bearer ' + tok } });
    if (!response.ok) throw new Error('count request failed: ' + response.status);
    const rows = await response.json();
    total += rows.length;
    if (rows.length < 100) return total;
  }
}

export async function toxic(proxy, name, type, attributes, stream = 'downstream') {
  const response = await fetch(`${TOXI}/proxies/${proxy}/toxics`, { method: 'POST', body: JSON.stringify({ name, type, stream, attributes }) });
  return response.status;
}
export async function untoxic(proxy, name) {
  await fetch(`${TOXI}/proxies/${proxy}/toxics/${name}`, { method: 'DELETE' });
}
export async function proxyEnabled(proxy, enabled) {
  const response = await fetch(`${TOXI}/proxies/${proxy}`, { method: 'POST', body: JSON.stringify({ enabled }) });
  return response.status;
}

// Waits for the form status line (role=status inside the form) to match one of the words.
export function waitStatus(page, pattern, timeout = 30000) {
  return page.waitForFunction(
    (source) => new RegExp(source, 'i').test(document.querySelector('form [role=status]')?.textContent || ''),
    pattern.source,
    { timeout },
  );
}

export function saveJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2));
}

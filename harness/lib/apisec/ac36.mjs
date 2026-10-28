// AC-36: the API returns generic 401 problem+json for every invalid credential, writes nothing, and still
// accepts valid ones (controls). env: API (Keycloak realm acme), API_FAKE (trusts the harness issuer), TOKFILE,
// EXPIRY_TOKEN_FILE (a real Keycloak token minted while the realm lifespan was 60 s), DB.
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicKey } from 'node:crypto';
import { Asserts, env, OUT, KC, mint, reqApi, b64u, decode, sql, sleep, kcAdmin, problemShape } from './lib.mjs';
const { generateKeyPair, SignJWT } = reqApi('jose');
const A = new Asserts('AC-36');
const now = Math.floor(Date.now() / 1000);

const jwks = await (await fetch(`${KC}/realms/acme/protocol/openid-connect/certs`)).json();
const kcKey = jwks.keys.find((k) => k.use === 'sig' && k.alg === 'RS256');
const pub = createPublicKey({ key: kcKey, format: 'jwk' });
const pem = pub.export({ type: 'spki', format: 'pem' }), der = pub.export({ type: 'spki', format: 'der' });
const claims = { iss: `${KC}/realms/acme`, aud: 'acme-api', sub: '16643c9b-461a-4283-95ef-47773836dac3', iat: now, exp: now + 300, azp: 'acme-cli' };
const { privateKey: foreign } = await generateKeyPair('RS256');
const hs = (secret) => new SignJWT(claims).setProtectedHeader({ alg: 'HS256', kid: kcKey.kid, typ: 'JWT' }).sign(typeof secret === 'string' ? new TextEncoder().encode(secret) : new Uint8Array(secret));
const valid = await mint({});
const seg = valid.split('.');

// Keycloak client whose tokens have no `sub`: a client without the `basic` scope (created through the admin API).
const nosubSecret = 'x' + Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('hex');
const mappers = [{ name: 'api-audience', protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper', config: { 'included.custom.audience': 'acme-api', 'access.token.claim': 'true', 'id.token.claim': 'false' } }];
const mk = await kcAdmin('POST', '/acme/clients', { clientId: 'sec-nosub', secret: nosubSecret, publicClient: false, standardFlowEnabled: false, directAccessGrantsEnabled: true, protocolMappers: mappers, defaultClientScopes: ['profile', 'email', 'roles'], fullScopeAllowed: true });
let nosubToken = null;
try { nosubToken = await mint({ client: 'sec-nosub', secret: nosubSecret }); } catch (e) { A.note('nosubMintError', String(e.message)); }
const nosubHasSub = nosubToken ? typeof decode(nosubToken).sub === 'string' : null;
A.note('keycloakNoSubClient', { created: mk.status, tokenMinted: !!nosubToken, tokenHasSub: nosubHasSub });

// Wait until the real Keycloak token minted at the start of the job has expired.
const expiredReal = readFileSync(env.EXPIRY_TOKEN_FILE, 'utf8').trim();
const expAt = decode(expiredReal).exp * 1000;
if (Date.now() < expAt + 2000) await sleep(expAt + 2000 - Date.now());
const fake = JSON.parse(readFileSync(env.TOKFILE, 'utf8'));

const M = env.API, F = env.API_FAKE;
const cases = [
  ['no Authorization header', M, null],
  ['empty Bearer', M, 'Bearer '],
  ['malformed: garbage', M, 'Bearer not-a-jwt'],
  ['malformed: three junk segments', M, 'Bearer a.b.c'],
  ['malformed: tampered payload on a real token', M, 'Bearer ' + seg[0] + '.' + b64u({ ...claims, sub: 'attacker' }) + '.' + seg[2]],
  ['malformed: Basic scheme', M, 'Basic ' + Buffer.from('alice:x').toString('base64')],
  ['foreign RSA key with Keycloak kid', M, 'Bearer ' + (await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: kcKey.kid, typ: 'JWT' }).sign(foreign))],
  ['alg none', M, 'Bearer ' + b64u({ alg: 'none', typ: 'JWT' }) + '.' + b64u(claims) + '.'],
  ['alg none with Keycloak kid', M, 'Bearer ' + b64u({ alg: 'none', kid: kcKey.kid }) + '.' + b64u(claims) + '.'],
  ['HS256 signed with realm public key (PEM) as secret', M, 'Bearer ' + (await hs(pem))],
  ['HS256 signed with realm public key (DER) as secret', M, 'Bearer ' + (await hs(der))],
  ['HS256 signed with the JWK JSON as secret', M, 'Bearer ' + (await hs(JSON.stringify(kcKey)))],
  ['HS256 signed with modulus n as secret', M, 'Bearer ' + (await hs(kcKey.n))],
  ['real token from realm other (mallory)', M, 'Bearer ' + (await mint({ realm: 'other', client: 'other-cli', secret: env.OTHER_CLI_SECRET, user: 'mallory', pass: env.MALLORY_PASSWORD }))],
  ['real token for client without the API audience (acme-noaud)', M, 'Bearer ' + (await mint({ client: 'acme-noaud', secret: env.ACME_NOAUD_SECRET }))],
  ['real expired Keycloak token', M, 'Bearer ' + expiredReal],
  ...(nosubToken && nosubHasSub === false ? [['real Keycloak token without sub', M, 'Bearer ' + nosubToken]] : []),
  ['nbf in the future (trusted signature)', F, 'Bearer ' + fake.nbf_future],
  ['missing sub (trusted signature)', F, 'Bearer ' + fake.missing_sub],
  ['empty sub (trusted signature)', F, 'Bearer ' + fake.empty_sub],
  ['expired (trusted signature)', F, 'Bearer ' + fake.expired],
  ['missing exp (trusted signature)', F, 'Bearer ' + fake.missing_exp],
  ['wrong iss (trusted signature)', F, 'Bearer ' + fake.wrong_iss],
  ['wrong aud (trusted signature)', F, 'Bearer ' + fake.wrong_aud],
];
const before = Number(sql(env.DB, 'SELECT count(*) FROM projects'));
const rows = [];
for (const [label, base, auth] of cases) {
  for (const [method, body] of [['GET', undefined], ['POST', JSON.stringify({ name: 'AC36-write-attempt' })]]) {
    const headers = { 'content-type': 'application/json' }; if (auth !== null) headers.authorization = auth;
    const r = await fetch(`${base}/v1/projects`, { method, headers, body }); const t = await r.text();
    const s = problemShape(r, t);
    rows.push({ label, method, status: r.status, ct: s.contentType, detail: s.json?.detail, code: s.json?.code });
    A.check(`${method} ${label}: 401 problem+json`, r.status === 401 && s.isProblemJson && s.hasFields, { status: r.status, ct: s.contentType });
  }
}
// Controls: valid tokens are accepted on both instances (so the 401s above are about the credentials).
const ctl1 = await fetch(M + '/v1/projects?limit=1', { headers: { authorization: 'Bearer ' + valid } });
const ctl2 = await fetch(F + '/v1/projects?limit=1', { headers: { authorization: 'Bearer ' + fake.control_valid } });
A.check('control: valid Keycloak token accepted (200)', ctl1.status === 200, { status: ctl1.status });
A.check('control: valid token from the harness issuer accepted (200)', ctl2.status === 200, { status: ctl2.status });
const details = [...new Set(rows.map((r) => r.detail))];
A.check('one generic detail string for every rejection (no hint about which check failed)', details.length === 1, details);
const after = Number(sql(env.DB, 'SELECT count(*) FROM projects'));
A.check('zero writes: SELECT count(*) FROM projects unchanged', before === after, { before, after });
writeFileSync(OUT + '/rows.json', JSON.stringify(rows, null, 1));
A.finish();

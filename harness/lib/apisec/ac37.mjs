// AC-37: signing-key rotation without restart. env: API (instance started with AUTH_JWKS_COOLDOWN_MS=30000,
// AUTH_JWKS_CACHE_MS=120000), COOLDOWN_MS, CACHE_MS. Timeline is written to OUT/timeline.jsonl.
import { appendFileSync } from 'node:fs';
import { Asserts, env, OUT, KC, mint, kcAdmin, sleep } from './lib.mjs';
const A = new Asserts('AC-37');
const COOLDOWN = Number(env.COOLDOWN_MS), CACHE = Number(env.CACHE_MS), API = env.API;
const rec = (o) => { const line = JSON.stringify({ at: new Date().toISOString(), ...o }); console.log(line); appendFileSync(OUT + '/timeline.jsonl', line + '\n'); };
const kid = (t) => JSON.parse(Buffer.from(t.split('.')[0], 'base64url')).kid;
const call = async (t) => (await fetch(API + '/v1/projects?limit=1', { headers: { authorization: 'Bearer ' + t } })).status;
const kids = async () => (await (await fetch(`${KC}/realms/acme/protocol/openid-connect/certs`)).json()).keys.filter((k) => k.use === 'sig').map((k) => k.kid);
let fivexx = 0;
// Long token lifetime so token expiry cannot mask key removal.
rec({ step: 'set realm accessTokenLifespan 900', status: (await kcAdmin('PUT', '/acme', { accessTokenLifespan: 900 })).status });
const realm = await (await kcAdmin('GET', '/acme')).json();
const comps = await (await kcAdmin('GET', '/acme/components?type=org.keycloak.keys.KeyProvider')).json();
const oldComp = comps.find((c) => c.providerId === 'rsa-generated');
A.check('found the active RS256 key provider (rsa-generated)', !!oldComp, comps.map((c) => c.providerId));
const old = await mint({});
const s0 = await call(old);
rec({ step: 'old token minted', kid: kid(old), apiStatus: s0, jwks: await kids() });
A.check('old-key token accepted before rotation', s0 === 200, { status: s0 });
const add = await kcAdmin('POST', '/acme/components', { name: 'harness-rotated', providerId: 'rsa-generated', providerType: 'org.keycloak.keys.KeyProvider', parentId: realm.id, config: { priority: ['200'], enabled: ['true'], active: ['true'], keySize: ['2048'], algorithm: ['RS256'] } });
const tAdd = Date.now();
rec({ step: 'added new RS256 provider priority 200', status: add.status, jwks: await kids() });
const neu = await mint({});
A.check('Keycloak now signs with a different kid', kid(neu) !== kid(old), { oldKid: kid(old), newKid: kid(neu) });
let tAccept = null;
for (let i = 0; i < 240 && !tAccept; i++) {
  const st = await call(neu); if (st >= 500) fivexx++;
  if (i % 10 === 0 || st === 200) rec({ step: 'poll new token', sinceAddMs: Date.now() - tAdd, status: st });
  if (st === 200) tAccept = Date.now(); else await sleep(500);
}
rec({ step: 'old token while both keys are published', status: await call(old) });
const acceptMs = tAccept ? tAccept - tAdd : null;
A.check(`new-key token accepted within cooldown (${COOLDOWN} ms) + 5 s`, acceptMs !== null && acceptMs <= COOLDOWN + 5000, { acceptedAfterMs: acceptMs, limitMs: COOLDOWN + 5000 });
// Remove the old key from the JWKS (disable + deactivate).
const comp = await (await kcAdmin('GET', '/acme/components/' + oldComp.id)).json();
comp.config.enabled = ['false']; comp.config.active = ['false'];
const dis = await kcAdmin('PUT', '/acme/components/' + oldComp.id, comp); const tRemove = Date.now();
const published = (await kids()).includes(kid(old));
rec({ step: 'disabled the old key provider', status: dis.status, oldKidStillPublished: published });
A.check('old key no longer published by Keycloak', dis.ok && !published);
let tReject = null;
for (let i = 0; i < 150 && !tReject; i++) {
  const so = await call(old), sn = await call(neu); if (so >= 500 || sn >= 500) fivexx++;
  if (i % 5 === 0 || so === 401) rec({ step: 'poll old/new', sinceRemoveMs: Date.now() - tRemove, oldStatus: so, newStatus: sn });
  if (so === 401) tReject = Date.now(); else await sleep(2000);
}
const rejectMs = tReject ? tReject - tRemove : null;
A.check(`removed-key token rejected within cache max age (${CACHE} ms) + 5 s`, rejectMs !== null && rejectMs <= CACHE + 5000, { rejectedAfterMs: rejectMs, limitMs: CACHE + 5000 });
A.check('new-key token still accepted after the old key was removed', (await call(neu)) === 200);
A.check('no 5xx at any point', fivexx === 0, { fivexx });
rec({ step: 'restore realm accessTokenLifespan 300', status: (await kcAdmin('PUT', '/acme', { accessTokenLifespan: 300 })).status });
A.finish();

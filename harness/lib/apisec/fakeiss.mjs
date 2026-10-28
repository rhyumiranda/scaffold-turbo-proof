// Minimal JWKS host for a harness-controlled issuer. It lets AC-36 test claims (nbf, sub, exp, iss, aud) that
// Keycloak cannot be told to get wrong, while the signature itself is trusted by the API under test.
// usage: node fakeiss.mjs <port> <tokens-file>   (tokens are written mode 600 outside the evidence folder)
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { reqApi } from './lib.mjs';
const { generateKeyPair, exportJWK, SignJWT } = reqApi('jose');
const port = Number(process.argv[2]), tokfile = process.argv[3];
const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), kid: 'harness-fake-1', alg: 'RS256', use: 'sig' };
const ISS = `http://127.0.0.1:${port}/realms/fake`;
const now = Math.floor(Date.now() / 1000);
const sign = (claims) => new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'harness-fake-1' }).sign(privateKey);
const base = { iss: ISS, aud: 'acme-api', sub: 'fake-alice', iat: now };
const tokens = {
  issuer: ISS,
  control_valid: await sign({ ...base, exp: now + 3600 }),
  nbf_future: await sign({ ...base, exp: now + 3600, nbf: now + 1800 }),
  missing_sub: await sign({ iss: ISS, aud: 'acme-api', iat: now, exp: now + 3600 }),
  empty_sub: await sign({ ...base, sub: '', exp: now + 3600 }),
  expired: await sign({ ...base, iat: now - 7200, exp: now - 3600 }),
  missing_exp: await sign({ ...base }),
  wrong_iss: await sign({ ...base, iss: `http://127.0.0.1:${port}/realms/other`, exp: now + 3600 }),
  wrong_aud: await sign({ ...base, aud: 'something-else', exp: now + 3600 }),
};
writeFileSync(tokfile, JSON.stringify(tokens), { mode: 0o600 });
createServer((q, s) => { if (q.url === '/certs') { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ keys: [jwk] })); } else { s.statusCode = 404; s.end(); } }).listen(port, '127.0.0.1', () => console.log('fake issuer listening on ' + port));

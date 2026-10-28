// Test-only protocol issuer. Never imported by application code.
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
export async function testIssuer(audience = 'reference-test') {
  const keys = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'oidc-test', alg: 'RS256', use: 'sig' };
  const codes = new Map(),
    refreshes = new Map();
  let refreshCount = 0,
    revocations = 0,
    outage = false;
  let base;
  const sign = (subject, aud, extra = {}, life = '5m') =>
    new SignJWT(extra)
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
      .setSubject(subject)
      .setIssuer(base)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(life)
      .sign(keys.privateKey);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, base);
      res.setHeader('content-type', 'application/json');
      if (outage) {
        res.writeHead(503);
        return res.end('{}');
      }
      const metadata = {
        issuer: base,
        authorization_endpoint: base + '/authorize',
        token_endpoint: base + '/token',
        jwks_uri: base + '/jwks',
        revocation_endpoint: base + '/revoke',
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
      };
      if (url.pathname === '/.well-known/openid-configuration') return res.end(JSON.stringify(metadata));
      if (url.pathname === '/jwks') return res.end(JSON.stringify({ keys: [jwk] }));
      if (url.pathname === '/authorize') {
        const code = randomUUID(),
          callback = new URL(url.searchParams.get('redirect_uri'));
        codes.set(code, {
          challenge: url.searchParams.get('code_challenge'),
          redirect: callback.href,
          nonce: url.searchParams.get('nonce'),
          client: url.searchParams.get('client_id'),
          subject: 'oidc-alice',
        });
        callback.searchParams.set('code', code);
        callback.searchParams.set('state', url.searchParams.get('state'));
        res.writeHead(302, { location: callback.href });
        return res.end();
      }
      let body = '';
      for await (const part of req) {
        body += part;
        if (body.length > 32768) throw new Error('too large');
      }
      const form = new URLSearchParams(body);
      if (url.pathname === '/revoke') {
        refreshes.delete(form.get('token'));
        revocations++;
        return res.end('{}');
      }
      if (url.pathname !== '/token') {
        res.writeHead(404);
        return res.end('{}');
      }
      let entry;
      if (form.get('grant_type') === 'authorization_code') {
        entry = codes.get(form.get('code'));
        codes.delete(form.get('code'));
        if (
          !entry ||
          entry.redirect !== form.get('redirect_uri') ||
          entry.client !== form.get('client_id') ||
          entry.challenge !==
            createHash('sha256')
              .update(form.get('code_verifier') ?? '')
              .digest('base64url')
        )
          throw new Error('invalid code');
      } else {
        entry = refreshes.get(form.get('refresh_token'));
        refreshes.delete(form.get('refresh_token'));
        refreshCount++;
        if (!entry) throw new Error('invalid refresh');
      }
      const refresh = randomUUID();
      refreshes.set(refresh, entry);
      res.end(
        JSON.stringify({
          access_token: await sign(entry.subject, audience),
          token_type: 'Bearer',
          expires_in: form.get('grant_type') === 'authorization_code' ? 1 : 300,
          refresh_token: refresh,
          id_token: await sign(entry.subject, entry.client, { nonce: entry.nonce }),
        }),
      );
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'invalid_grant' }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  return {
    base,
    sign,
    stats: () => ({ refreshCount, revocations }),
    outage: (value) => {
      outage = value;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

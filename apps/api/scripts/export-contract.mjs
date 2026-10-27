import { writeFile } from 'node:fs/promises';

// The schema comes from code metadata only. Fixed placeholder settings (the same ones contract:check uses) make the
// output independent of the shell's environment, so no database, identity provider or secret is needed. Nothing
// connects during export.
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://127.0.0.1:1/metadata_only',
  AUTH_ISSUER: 'https://example.invalid',
  AUTH_AUDIENCE: 'metadata',
  AUTH_JWKS_URL: 'https://example.invalid/jwks',
});
const { createApp, contract } = await import('../dist/app.js');
const app = await createApp();
try {
  await writeFile(new URL('../openapi.json', import.meta.url), JSON.stringify(contract(app), null, 2) + '\n');
} finally {
  await app.close();
}

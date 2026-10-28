// usage: node forge.mjs <issuer> <audience> <kid>   prints an RS256 JWT signed by a fresh random key
import { createRequire } from 'node:module';
const require = createRequire(process.env.WS + '/apps/api/package.json');
const { generateKeyPair, SignJWT } = await import(require.resolve('jose'));
const [iss, aud, kid] = process.argv.slice(2);
const { privateKey } = await generateKeyPair('RS256');
console.log(await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid }).setIssuer(iss).setAudience(aud).setSubject('forged').setIssuedAt().setExpirationTime('5m').sign(privateKey));

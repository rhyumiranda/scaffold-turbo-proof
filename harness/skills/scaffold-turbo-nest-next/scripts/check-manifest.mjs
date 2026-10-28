import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const target = process.argv[2];
if (!target) throw new Error('Usage: node check-manifest.mjs /absolute/repository/scaffold-manifest.json');
const path = resolve(target);
const root = dirname(path);
const data = JSON.parse(await readFile(path, 'utf8'));
const errors = [];
if (data.schemaVersion !== 1 || data.skill !== 'scaffold-turbo-nest-next') errors.push('Unsupported manifest schema or skill');
if (!['generated', 'locally_verified', 'deployment_verified'].includes(data.status)) errors.push('Invalid status');
if (data.runtime !== '24.22.1' || data.packageManager !== 'pnpm@12.15.0' || data.turbo !== '2.11.10') errors.push('Unexpected version provenance');
const companionVersions = { nest: '1.4.0', next: '1.4.0' };
for (const [companion, version] of Object.entries(companionVersions)) if (data.companions?.[companion]?.referenceVersion !== version) errors.push(`Unsupported ${companion} companion provenance`);
for (const [file, expected] of Object.entries(data.checksums ?? {})) {
  try {
    await access(join(root, file));
    const actual = createHash('sha256').update(await readFile(join(root, file))).digest('hex');
    if (actual !== expected) errors.push(`Generated file changed: ${file}`);
  } catch { errors.push(`Generated file missing: ${file}`); }
}
for (let index = 1; index <= 9; index++) {
  const gate = data.gates?.[`G${String(index).padStart(2, '0')}`];
  if (!gate || !['not_run', 'passed', 'failed', 'blocked'].includes(gate.status) || !Array.isArray(gate.evidence)) errors.push(`Invalid gate G${String(index).padStart(2, '0')}`);
}
const catalog = (await readFile(new URL('../references/requirements.md', import.meta.url), 'utf8')).match(/^- ([A-Z]\d{2}) /gm)?.map(line => line.slice(2, 5)) ?? [];
const recorded = Object.keys(data.requirements ?? {});
for (const id of catalog) {
  const entry = data.requirements?.[id];
  if (!entry || !['not_run', 'passed', 'failed', 'blocked', 'not_applicable'].includes(entry.status) || !Array.isArray(entry.evidence)) errors.push(`Invalid or missing requirement ${id}`);
}
for (const id of recorded) if (!catalog.includes(id)) errors.push(`Unknown requirement ${id}`);
if (data.intake !== null && (typeof data.intake !== 'object' || Array.isArray(data.intake))) errors.push('Invalid intake record');
if (!['provider-configuration-required', 'external-cookie-selected-provider-unverified', 'oidc-selected-provider-unverified'].includes(data.authIntegration)) errors.push('Invalid authIntegration');
for (const [name, gate] of Object.entries(data.gates ?? {}))
  if (gate?.status === 'passed' && !(Array.isArray(gate.evidence) && gate.evidence.length > 0)) errors.push(`Gate ${name} passed without evidence`);
for (const [id, entry] of Object.entries(data.requirements ?? {}))
  if (entry?.status === 'passed' && !(Array.isArray(entry.evidence) && entry.evidence.length > 0)) errors.push(`Requirement ${id} passed without evidence`);
if (data.gates?.G09?.status === 'passed' && data.deployment !== 'verified') errors.push('G09 passed requires deployment: verified with target evidence');
if (data.status === 'locally_verified' && Object.values(data.gates).some(gate => gate.status !== 'passed')) errors.push('Locally verified requires every local gate passed');
if (data.status === 'deployment_verified' && data.deployment !== 'verified') errors.push('Deployment verified status requires verified deployment evidence');
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Composite scaffold manifest is internally consistent.');

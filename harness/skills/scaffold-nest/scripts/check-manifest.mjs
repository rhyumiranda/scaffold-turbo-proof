import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const statuses = new Set(['passed', 'failed', 'blocked', 'not_run', 'not_applicable']);
const profiles = new Set(['tenancy', 'idempotency', 'jobs', 'webhooks', 'uploads', 'realtime', 'optimistic', 'ai',
  'oidc', 'replicas', 'redis-limiter', 'telemetry', 'recovery', 'container', 'load', 'accessibility']);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const evidence = value => Array.isArray(value) && value.length > 0 && value.every(nonempty);

export function validate(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['Expected a JSON object'];
  if (data.schemaVersion !== 2) errors.push('schemaVersion must be 2; retain old evidence and review before migrating a v1 report');
  if (!['scaffold-next', 'scaffold-nest'].includes(data.skill)) errors.push('Unknown skill');
  if (!['generated', 'locally_verified', 'deployment_verified'].includes(data.status)) errors.push('Invalid completion status');
  const verified = ['locally_verified', 'deployment_verified'].includes(data.status);
  if (!nonempty(data.referenceVersion) || !nonempty(data.runtime) || !nonempty(data.packageManager)) errors.push('Missing version provenance');
  if (!Array.isArray(data.generatedFiles) || !data.generatedFiles.length || !data.generatedFiles.every(nonempty)) errors.push('Missing generated file inventory');
  if (!data.checksums || typeof data.checksums !== 'object' || (Array.isArray(data.generatedFiles) && data.generatedFiles.some(file => !/^[a-f0-9]{64}$/.test(data.checksums[file] ?? '')))) errors.push('Missing generated file checksums');
  if (!Array.isArray(data.generatorCommand) || !data.generatorCommand.length || !data.generatorCommand.every(nonempty)) errors.push('Missing generator command');
  const selected = Array.isArray(data.selectedProfiles) ? data.selectedProfiles : [];
  if (!Array.isArray(data.selectedProfiles) || selected.some(profile => !profiles.has(profile)) || new Set(selected).size !== selected.length) errors.push('selectedProfiles must list unique supported profile names');
  if (!['provider-configuration-required', 'provider-integrated', 'public-only'].includes(data.authIntegration)) errors.push('Missing or invalid authIntegration');
  if (!Array.isArray(data.authEvidence) || !data.authEvidence.every(nonempty)) errors.push('authEvidence must be an array of evidence records');
  if (!['unconfigured', 'fixture-only', 'real-api', 'real-api-database'].includes(data.integration)) errors.push('Missing or invalid integration classification');
  if (verified) {
    if (data.authIntegration === 'provider-configuration-required') errors.push('Authentication integration unresolved');
    if (!evidence(data.authEvidence)) errors.push('Verified auth/public-only profile requires evidence');
    const expected = data.skill === 'scaffold-nest' ? 'real-api-database' : 'real-api';
    if (data.integration !== expected) errors.push('Local verification requires ' + expected + ', not fixtures or an unconfigured integration');
  }
  if (!data.gates || typeof data.gates !== 'object' || Array.isArray(data.gates)) return [...errors, 'Missing gates'];
  for (let i = 1; i <= 9; i++) {
    const id = 'G' + String(i).padStart(2, '0'), gate = data.gates[id];
    if (!gate || typeof gate !== 'object' || Array.isArray(gate)) { errors.push('Missing ' + id); continue; }
    if (!statuses.has(gate.status)) errors.push(id + ': invalid status');
    if (!Array.isArray(gate.evidence) || !gate.evidence.every(nonempty)) errors.push(id + ': evidence must be nonempty strings in an array');
    if (gate.status === 'passed' && !evidence(gate.evidence)) errors.push(id + ': passed without evidence');
    if (['failed', 'blocked', 'not_applicable'].includes(gate.status) && !nonempty(gate.reason)) errors.push(id + ': reason required');
    if (gate.status === 'not_applicable' && id !== 'G06') errors.push(id + ': cannot waive this gate');
    if (verified && i <= 8 && gate.status !== 'passed' && !(id === 'G06' && gate.status === 'not_applicable')) errors.push(id + ': local verification incomplete');
  }
  if (data.gates.G04?.status === 'passed') {
    if (data.authIntegration === 'provider-configuration-required') errors.push('G04: authentication integration unresolved; retain synthetic tests as partial evidence under blocked');
    if (!evidence(data.authEvidence)) errors.push('G04: actual auth/public-only policy evidence required');
  }
  if (data.gates.G06?.status === 'not_applicable' && selected.length) errors.push('G06: selected optional profiles cannot be waived');
  if (data.gates.G06?.status === 'passed') {
    for (const profile of selected) {
      if (!evidence(data.profileEvidence?.[profile])) errors.push('G06: missing evidence for selected profile ' + profile);
    }
  }
  if (data.status === 'deployment_verified' && data.gates.G09?.status !== 'passed') errors.push('Deployment evidence missing');
  return errors;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node check-manifest.mjs /absolute/scaffold-manifest.json');
    const errors = validate(JSON.parse(await readFile(process.argv[2], 'utf8')));
    console.log(JSON.stringify({valid: errors.length === 0, errors, scope: 'Report consistency only; application checks were not executed.'}, null, 2));
    process.exitCode = errors.length ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

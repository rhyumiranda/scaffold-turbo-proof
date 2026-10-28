import {readFile, writeFile, mkdir, rename, realpath} from 'node:fs/promises';
import {resolve, join, isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {validate} from './check-manifest.mjs';

const plans = {
  G02: ['@install', 'lint', 'check:arch', 'typecheck', 'build', 'test:unit', 'contract:check', 'contract:compat', 'check:secrets'],
  G03: ['test:integration'],
  G07: ['test:runtime'],
};
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--project' || !isAbsolute(args[1] ?? '') || args[2] !== '--gate' || !plans[args[3]]) {
  console.error('Usage: node verify.mjs --project /absolute/project --gate G02|G03|G07');
  process.exit(2);
}
const project = await realpath(args[1]), gate = args[3];
const manifestPath = join(project, 'scaffold-manifest.json');
const original = await readFile(manifestPath, 'utf8'), manifest = JSON.parse(original);
const errors = validate(manifest);
if (errors.length) throw new Error('Fix manifest before running: ' + errors.join('; '));
const pkg = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
// Accept any Node inside the project's engines range (default: the recorded runtime's major line), not one exact patch.
export function satisfies(version, range) {
  const parse = value => value.replace(/^v/, '').split('.').map(Number);
  const compare = (a, b) => { for (let i = 0; i < 3; i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return Math.sign(d); } return 0; };
  const current = parse(version);
  return range.trim().split(/\s+/).every(token => {
    const match = token.match(/^(>=|<=|>|<|=)?(\d+(?:\.\d+){0,2})$/);
    if (!match) throw new Error('Unsupported engines.node comparator: ' + token);
    const c = compare(current, parse(match[2]));
    return { '>=': c >= 0, '<=': c <= 0, '>': c > 0, '<': c < 0, '=': c === 0 }[match[1] ?? '='];
  });
}
const nodeRange = pkg.engines?.node ?? `>=${manifest.runtime} <${Number(manifest.runtime.split('.')[0]) + 1}`;
if (!satisfies(process.versions.node, nodeRange)) throw new Error(`Use Node ${nodeRange} (recorded ${manifest.runtime}); current ${process.versions.node}`);
for (const extra of ['check:docs', 'check:budget']) if (pkg.scripts?.[extra]) plans.G02.push(extra);
const records = [];
function redact(text) {
  let safe = text;
  for (const [key, value] of Object.entries(process.env)) {
    if (/TOKEN|SECRET|PASSWORD|DATABASE_URL|PRIVATE_KEY/i.test(key) && value && value.length >= 4) safe = safe.split(value).join('[REDACTED]');
  }
  return safe.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');
}
async function run(script) {
  const npmArgs = script === '@install' ? ['ci', '--ignore-scripts'] : ['run', script];
  const command = ['npm', ...npmArgs], started = Date.now();
  if (script !== '@install' && !pkg.scripts?.[script]) return {command, exitCode:null, passed:false, reason:'Required script missing: ' + script, durationMs:0};
  return new Promise(resolveResult => {
    let output = '', timedOut = false;
    const child = spawn('npm', npmArgs, {cwd:project, env:process.env, detached:process.platform !== 'win32', stdio:['ignore','pipe','pipe']});
    const capture = data => { output = (output + data.toString()).slice(-32768); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    let force;
    const terminate = signal => {
      try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Already exited. */ }
    };
    const timer = setTimeout(() => { timedOut = true; terminate('SIGTERM'); force = setTimeout(() => terminate('SIGKILL'), 5000); }, 180000);
    child.once('error', error => capture(error.message));
    child.once('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(force);
      const safeOutput = redact(output);
      if (safeOutput) process.stdout.write(safeOutput);
      resolveResult({command, exitCode:code, signal, passed:code === 0 && !timedOut, timedOut, durationMs:Date.now()-started, outputSha256:createHash('sha256').update(safeOutput).digest('hex')});
    });
  });
}
for (const script of plans[gate]) {
  const record = await run(script); records.push(record);
  if (!record.passed) break;
}
const passed = records.length === plans[gate].length && records.every(record => record.passed);
const directory = join(project, '.scaffold', 'evidence');
await mkdir(directory, {recursive:true});
const artifact = join(directory, gate + '-' + randomUUID() + '.json');
await writeFile(artifact, JSON.stringify({schemaVersion:1, gate, project, runtime:process.versions.node, observedAt:new Date().toISOString(), passed, checks:records},null,2)+'\n', {flag:'wx',mode:0o600});
if (await readFile(manifestPath,'utf8') !== original) throw new Error('Manifest changed during verification. Evidence saved; refusing to overwrite concurrent edits: '+artifact);
manifest.gates[gate] = {status:passed?'passed':'failed',evidence:[artifact],...(passed?{}:{reason:'Required command failed or is missing; inspect evidence'})};
// A command result cannot decide authorization, optional-profile applicability, or deployment readiness.
manifest.status = 'generated';
const temporary = manifestPath + '.' + randomUUID() + '.tmp';
await writeFile(temporary,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
await rename(temporary,manifestPath);
console.log(JSON.stringify({gate,passed,evidence:artifact,completion:'generated; review all other gates and integration before changing status'}));
process.exitCode = passed ? 0 : 1;

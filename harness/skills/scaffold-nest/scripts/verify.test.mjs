import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const script=join(dirname(fileURLToPath(import.meta.url)),'verify.mjs');
test('G02 cannot pass when the secret scanner fails',async()=>{
  const scripts=Object.fromEntries(['lint','check:arch','typecheck','build','test:unit','contract:check','contract:compat'].map(name=>[name,'node -e "process.exit(0)"']));
  const project=await fixture({...scripts,'check:secrets':'node -e "process.exit(7)"'});
  const lock=spawnSync('npm',['install','--package-lock-only','--ignore-scripts','--offline','--no-audit'],{cwd:project,encoding:'utf8'});
  assert.equal(lock.status,0,lock.stderr);
  const result=spawnSync(process.execPath,[script,'--project',project,'--gate','G02'],{encoding:'utf8'});
  assert.equal(result.status,1,result.stderr);
  const manifest=JSON.parse(await readFile(join(project,'scaffold-manifest.json')));
  assert.equal(manifest.gates.G02.status,'failed');
  const evidence=JSON.parse(await readFile(manifest.gates.G02.evidence[0]));
  assert.deepEqual(evidence.checks.at(-1).command,['npm','run','check:secrets']);
  assert.equal(evidence.checks.at(-1).exitCode,7);
});
const projects=[];
after(()=>Promise.all(projects.map(project=>rm(project,{recursive:true,force:true}))));
async function fixture(scripts, engines) {
  const project=await mkdtemp(join(tmpdir(),'scaffold-verify-'));
  projects.push(project);
  await writeFile(join(project,'package.json'),JSON.stringify({name:'verify-test',private:true,scripts,...(engines?{engines:{node:engines}}:{})}));
  await writeFile(join(project,'scaffold-manifest.json'),JSON.stringify({
    schemaVersion:2,skill:'scaffold-next',referenceVersion:'1.1.0',runtime:process.versions.node,packageManager:'npm@11.17.0',
    generatedFiles:['package.json'],checksums:{'package.json':'a'.repeat(64)},generatorCommand:['node','scaffold.mjs'],
    selectedProfiles:[],profileEvidence:{},authIntegration:'provider-configuration-required',authEvidence:[],integration:'unconfigured',status:'generated',
    gates:Object.fromEntries(Array.from({length:9},(_,i)=>['G'+String(i+1).padStart(2,'0'),{status:'not_run',evidence:[]}]))
  }));
  return project;
}
test('records real command failure without promoting completion',async()=>{
  const project=await fixture({'test:integration':'node -e "process.exit(7)"'});
  const result=spawnSync(process.execPath,[script,'--project',project,'--gate','G03'],{encoding:'utf8'});
  assert.equal(result.status,1,result.stderr);
  const manifest=JSON.parse(await readFile(join(project,'scaffold-manifest.json')));
  assert.equal(manifest.gates.G03.status,'failed');assert.equal(manifest.status,'generated');
  const artifact=JSON.parse(await readFile(manifest.gates.G03.evidence[0]));
  assert.equal(artifact.checks[0].exitCode,7);assert.equal(artifact.passed,false);
});
test('missing commands fail rather than silently skipping a gate',async()=>{
  const project=await fixture({});
  const result=spawnSync(process.execPath,[script,'--project',project,'--gate','G07'],{encoding:'utf8'});
  assert.equal(result.status,1,result.stderr);
  const manifest=JSON.parse(await readFile(join(project,'scaffold-manifest.json')));
  const artifact=JSON.parse(await readFile(manifest.gates.G07.evidence[0]));
  assert.match(artifact.checks[0].reason,/Required script missing/);
});
test('successful command verifies only its gate; auth and other gates stay unresolved',async()=>{
  const project=await fixture({'test:integration':'node -e "process.exit(0)"'});
  const result=spawnSync(process.execPath,[script,'--project',project,'--gate','G03'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const manifest=JSON.parse(await readFile(join(project,'scaffold-manifest.json')));
  assert.equal(manifest.gates.G03.status,'passed');assert.equal(manifest.gates.G04.status,'not_run');
  assert.equal(manifest.authIntegration,'provider-configuration-required');assert.equal(manifest.status,'generated');
});
test('accepts any Node inside engines and refuses one outside it',async()=>{
  const [major]=process.versions.node.split('.').map(Number);
  const inside=await fixture({'test:runtime':'node -e ""'},`>=${major}.0.0 <${major+1}`);
  assert.equal(spawnSync(process.execPath,[script,'--project',inside,'--gate','G07'],{encoding:'utf8'}).status,0);
  const outside=await fixture({'test:runtime':'node -e ""'},`>=${major+1}.0.0 <${major+2}`);
  const refused=spawnSync(process.execPath,[script,'--project',outside,'--gate','G07'],{encoding:'utf8'});
  assert.notEqual(refused.status,0);assert.match(refused.stderr,/Use Node/);
});

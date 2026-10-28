import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,symlink,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validate} from './check-manifest.mjs';
const script=join(dirname(fileURLToPath(import.meta.url)),'scaffold.mjs');
const base=await mkdtemp(join(tmpdir(),'scaffold-generator-tests-'));
after(()=>rm(base,{recursive:true,force:true}));
const call=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
test('dry run has no filesystem side effects',async()=>{
 const destination=join(base,'dry run');
 assert.equal(call('--destination',destination,'--name','example','--dry-run').status,0);
 await assert.rejects(access(destination));
});
test('creates a complete locked reference in a path with spaces',async()=>{
 const destination=join(base,'generated app');
 const result=call('--destination',destination,'--name','example-app');
 assert.equal(result.status,0,result.stderr);
 assert.equal(JSON.parse(await readFile(join(destination,'package.json'))).name,'example-app');
 assert.equal(JSON.parse(await readFile(join(destination,'package-lock.json'))).packages[''].name,'example-app');
 await assert.rejects(access(join(destination,'node_modules')));
 const manifest=JSON.parse(await readFile(join(destination,'scaffold-manifest.json')));
 assert.deepEqual(validate(manifest),[]);
 assert.equal(manifest.integration,'unconfigured');
 assert.equal(manifest.schemaVersion,2);
 assert.ok(Object.values(manifest.gates).every(g=>g.status==='not_run'));
 assert.equal(manifest.checksums['package.json'].length,64);
 await writeFile(join(destination,'package.json'),'user edit\n');
 assert.notEqual(call('--destination',destination,'--name','example-app').status,0);
 assert.equal(await readFile(join(destination,'package.json'),'utf8'),'user edit\n');
});
test('interrupted generation never overwrites partial user work',async()=>{
 const destination=join(base,'interrupted');
 await mkdir(destination);
 await writeFile(join(destination,'.scaffold-in-progress'),'Interrupted');
 await writeFile(join(destination,'user-work.txt'),'Keep this');
 assert.notEqual(call('--destination',destination,'--name','valid').status,0);
 assert.equal(await readFile(join(destination,'user-work.txt'),'utf8'),'Keep this');
 // Recovery uses a new destination, then a human/agent-reviewed merge, never an overwrite.
 assert.equal(call('--destination',join(base,'recovered'),'--name','valid').status,0);
});
test('rejects invalid names, traversal, unknown flags and destination symlinks',async()=>{
 assert.notEqual(call('--destination',join(base,'invalid'),'--name','bad;name').status,0);
 assert.notEqual(call('--destination',base+'/../escape','--name','valid').status,0);
 assert.notEqual(call('--bad').status,0);
 const target=join(base,'link');await symlink(resolve(base),target);
 assert.notEqual(call('--destination',target,'--name','valid').status,0);
});

import { mkdir, lstat, readdir, readFile, writeFile, copyFile, realpath, access } from 'node:fs/promises';
import { resolve, dirname, basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const options = new Map();
for (let i=2;i<process.argv.length;i++) {
  const key=process.argv[i];
  if(key==='--dry-run') options.set(key,true);
  else if(['--destination','--name'].includes(key) && process.argv[i+1]) options.set(key,process.argv[++i]);
  else throw new Error('Usage: node scaffold.mjs --destination /absolute/new-directory --name app-name [--dry-run]');
}
const requested=options.get('--destination'), name=options.get('--name');
if(typeof requested!=='string'||typeof name!=='string'||!requested.startsWith('/')||requested.split('/').includes('..'))
  throw new Error('Supply an absolute destination without traversal and a name.');
if(!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error(`Invalid name ${JSON.stringify(name)}: use 1 to 64 characters, start with a lowercase letter, then only lowercase letters, digits or hyphens${name.length > 64 ? ` (it has ${name.length} characters)` : ''}.`);
const skill=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const template=join(skill,'assets','reference');
const parent = await realpath(dirname(resolve(requested))).catch((error) => {
  if (error.code === 'ENOENT') throw new Error(`Destination parent folder does not exist: ${dirname(resolve(requested))}. Create it first.`);
  throw error;
});
const destination=join(parent,basename(requested));
if(destination===parent) throw new Error('Destination must be a new child directory.');
try { await lstat(destination); throw new Error('Destination exists. Refusing overwrite or automatic upgrade.'); }
catch(error) { if(error.code!=='ENOENT') throw error; }
const ignored=new Set(['node_modules','dist','.next','.git','test-results','identity-test-results','playwright-report','coverage']);
const files=[];
async function collect(directory) {
 for(const entry of await readdir(directory,{withFileTypes:true})) {
   if(ignored.has(entry.name)||entry.name.endsWith('.tsbuildinfo')||entry.name==='.DS_Store') continue;
   if(entry.name.startsWith('.env')&&entry.name!=='.env.example') continue;
   const path=join(directory,entry.name);
   if(entry.isSymbolicLink()) throw new Error('Template contains a symlink: '+relative(template,path));
   if(entry.isDirectory()) await collect(path);
   else if(entry.isFile()) files.push(relative(template,path));
 }
}
await collect(template);
files.sort();
await access(join(template,'package-lock.json'));
const preview={skill:basename(skill),destination,name,files,installs:false,commits:false,deployment:false};
if(options.has('--dry-run')) { console.log(JSON.stringify(preview,null,2)); process.exit(0); }
await mkdir(destination); // Exclusive creation: a concurrent creator fails without overwriting.
await writeFile(join(destination,'.scaffold-in-progress'),'Generation interrupted if this file remains. Review files; do not rerun over edits.\n',{flag:'wx'});
for(const path of files) {
 const target=join(destination,path);
 await mkdir(dirname(target),{recursive:true});
 await copyFile(join(template,path),target,1); // COPYFILE_EXCL
}
for(const filename of ['package.json','package-lock.json']) {
 const path=join(destination,filename), data=JSON.parse(await readFile(path,'utf8'));
 data.name=name;
 if(data.packages?.['']) data.packages[''].name=name;
 await writeFile(path,JSON.stringify(data,null,2)+'\n');
}
const packages=JSON.parse(await readFile(join(destination,'package.json'),'utf8'));
const checksums=Object.fromEntries(await Promise.all(files.map(async path=>[path,createHash('sha256').update(await readFile(join(destination,path))).digest('hex')])));
const manifest={
 schemaVersion:2,skill:basename(skill),referenceVersion:'1.4.0',status:'generated',
 runtime:'24.22.1',packageManager:packages.packageManager,dependencies:packages.dependencies,checksums,generatedFiles:files,authIntegration:'provider-configuration-required',
 generatedAt:new Date().toISOString(),generatorCommand:['node',...process.argv.slice(1)],
 selectedProfiles:[],profileEvidence:{},authEvidence:[],integration:'unconfigured',
 commands:packages.scripts,devDependencies:packages.devDependencies,
 deployment:'unverified',gates:Object.fromEntries(Array.from({length:9},(_,i)=>['G'+String(i+1).padStart(2,'0'),{status:'not_run',evidence:[]}]))
};
await writeFile(join(destination,'scaffold-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
const {unlink}=await import('node:fs/promises');
await unlink(join(destination,'.scaffold-in-progress'));
console.log(JSON.stringify({...preview,status:'generated',next:'Use Node 24.22.1; run npm ci, then follow the reference walkthrough. Authentication and deployment are not configured.'},null,2));

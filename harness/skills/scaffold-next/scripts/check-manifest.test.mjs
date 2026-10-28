import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate} from './check-manifest.mjs';
test('runtime profile selections require individual evidence and cannot be waived',()=>{
  const m=base();
  m.selectedProfiles=['oidc','replicas','redis-limiter','telemetry','recovery','container','load','accessibility'];
  m.gates.G06={status:'passed',evidence:['runtime-summary.json']};
  assert.ok(validate(m).some(x=>x.includes('missing evidence for selected profile oidc')));
  m.profileEvidence=Object.fromEntries(m.selectedProfiles.map(p=>[p,[p+'-result.json']]));
  assert.deepEqual(validate(m),[]);
  delete m.profileEvidence.replicas;
  assert.ok(validate(m).some(x=>x.includes('missing evidence for selected profile replicas')));
  m.gates.G06={status:'not_applicable',evidence:[],reason:'none'};
  assert.ok(validate(m).some(x=>x.includes('cannot be waived')));
  m.gates.G06={status:'blocked',evidence:['oidc-result.json'],reason:'Docker daemon unavailable'};
  assert.deepEqual(validate(m),[]);
  m.selectedProfiles.push('oidc');
  assert.ok(validate(m).some(x=>x.includes('unique supported profile names')));
});
test('local OIDC profile evidence never resolves the real-provider gate',()=>{
  const m=base();m.selectedProfiles=['oidc'];m.profileEvidence={oidc:['synthetic-oidc-result.json']};
  m.gates.G06={status:'passed',evidence:['synthetic-oidc-result.json']};
  assert.deepEqual(validate(m),[]);
  m.gates.G04={status:'passed',evidence:['synthetic-oidc-result.json']};
  assert.ok(validate(m).some(x=>x.includes('G04: authentication integration unresolved')));
});
function base() {
  return {schemaVersion:2, skill:'scaffold-next', referenceVersion:'1.1.0', runtime:'24.22.1', packageManager:'npm@11.17.0',
    generatedFiles:['package.json'], checksums:{'package.json':'a'.repeat(64)}, generatorCommand:['node','scaffold.mjs'],
    selectedProfiles:[], profileEvidence:{}, authIntegration:'provider-configuration-required', authEvidence:[],
    integration:'unconfigured', status:'generated',
    gates:Object.fromEntries(Array.from({length:9},(_,i)=>['G'+String(i+1).padStart(2,'0'),{status:'not_run',evidence:[]}]))};
}
function verified() {
  const data = base();
  data.status='locally_verified'; data.authIntegration='provider-integrated'; data.authEvidence=['tests/provider-session.json']; data.integration='real-api';
  for (const [id, gate] of Object.entries(data.gates)) if (id!=='G09') Object.assign(gate,{status:'passed',evidence:['tests/observed-result.json']});
  return data;
}
test('generated is not locally verified',()=>{const m=base();assert.deepEqual(validate(m),[]);m.status='locally_verified';assert.ok(validate(m).length);});
test('pass requires evidence and blocked requires reason',()=>{const m=base();m.gates.G02.status='passed';assert.ok(validate(m).some(x=>x.includes('without evidence')));m.gates.G02={status:'blocked',evidence:[]};assert.ok(validate(m).some(x=>x.includes('reason')));});
test('security and target gates cannot be waived',()=>{const m=base();m.gates.G04={status:'not_applicable',evidence:[],reason:'not run'};assert.ok(validate(m).length);m.status='deployment_verified';assert.ok(validate(m).some(x=>x.includes('Deployment')));});
test('only genuinely unselected optional profiles can be waived',()=>{const m=base();m.gates.G06={status:'not_applicable',evidence:[],reason:'No optional profiles selected'};assert.deepEqual(validate(m),[]);m.selectedProfiles=['jobs'];assert.ok(validate(m).some(x=>x.includes('cannot be waived')));});
test('missing authentication or fixture integration cannot claim verification',()=>{const m=verified();assert.deepEqual(validate(m),[]);delete m.authIntegration;assert.ok(validate(m).some(x=>x.includes('authIntegration')));m.authIntegration='provider-integrated';m.integration='fixture-only';assert.ok(validate(m).some(x=>x.includes('not fixtures')));});
test('selected profile evidence is required individually',()=>{const m=verified();m.selectedProfiles=['jobs','ai'];m.profileEvidence={jobs:['jobs-result.json']};assert.ok(validate(m).some(x=>x.includes('profile ai')));m.profileEvidence.ai=['ai-result.json'];assert.deepEqual(validate(m),[]);});
test('public-only needs policy evidence, and Nest needs database evidence',()=>{const m=verified();m.authIntegration='public-only';m.authEvidence=[];assert.ok(validate(m).length);m.authEvidence=['reviewed-public-data-policy.md'];assert.deepEqual(validate(m),[]);m.skill='scaffold-nest';assert.ok(validate(m).length);m.integration='real-api-database';assert.deepEqual(validate(m),[]);});
test('legacy and incomplete provenance reports are rejected',()=>{const m=base();m.schemaVersion=1;assert.ok(validate(m).length);m.schemaVersion=2;delete m.checksums['package.json'];assert.ok(validate(m).length);});
test('a generated report cannot pass G04 with only synthetic auth evidence',()=>{
  const m=base();
  m.gates.G04={status:'passed',evidence:['synthetic-jwt-tests.json']};
  assert.ok(validate(m).some(x=>x.includes('G04: authentication integration unresolved')));
  m.authIntegration='provider-integrated';
  assert.ok(validate(m).some(x=>x.includes('G04: actual auth/public-only policy evidence required')));
  m.authEvidence=['actual-provider-session-tests.json'];
  assert.deepEqual(validate(m),[]);
  m.authIntegration='provider-configuration-required'; m.authEvidence=[];
  m.gates.G04={status:'blocked',evidence:['synthetic-jwt-tests.json'],reason:'Actual provider and session lifecycle not configured'};
  assert.deepEqual(validate(m),[]);
});

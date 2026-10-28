import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectArchitecture } from './check-architecture.mjs';
const check = (files) => inspectArchitecture(new Map(Object.entries(files)));
test('reject direct transport in client UI, aliases and hooks', () => {
  for (const code of ["fetch('/api/x')", "const send=fetch; send('/api/x')", "window.fetch('/api/x')"])
    assert.match(check({ 'src/features/a/components/a.tsx': `'use client'; ${code}` }).join('\n'), /Raw transport/);
  assert.match(
    check({ 'src/features/a/hooks/a.ts': "export function useA(){fetch('/api')}" }).join('\n'),
    /Raw transport/,
  );
  assert.match(
    check({ 'src/lib/hidden-transport.ts': "export const load=()=>fetch('/api')" }).join('\n'),
    /Raw transport/,
  );
});
test('reject feature private imports, reexports, cycles and indirect server leaks', () => {
  assert.match(
    check({
      'src/features/a/services/a.ts': "import '../b'; export {x} from '@/features/b/services/b'",
      'src/features/b/services/b.ts': 'export const x=1',
    }).join('\n'),
    /Cross-feature/,
  );
  assert.match(
    check({
      'src/features/a/services/a.ts': "import '@/features/b/services'",
      'src/features/b/services/index.ts': 'export const x=1',
    }).join('\n'),
    /Cross-feature/,
  );
  assert.match(
    check({ 'src/features/a/services/a.ts': "import './b'", 'src/features/a/services/b.ts': "import './a'" }).join(
      '\n',
    ),
    /Import cycle/,
  );
  assert.match(
    check({
      'src/features/a/components/a.tsx': "'use client'; import '@/lib/shared'",
      'src/lib/shared.ts': "import 'server-only'",
    }).join('\n'),
    /reachable/,
  );
});
test('allow server reads, hook-owned actions, server-only forms, type-only imports and public feature exports', () => {
  assert.deepEqual(
    check({
      'src/app/page.tsx': "import '@/features/a'",
      'src/features/a/index.ts': "export * from './services/a.server'",
      'src/features/a/components/server.tsx': "import '../services/a.server'",
      'src/features/a/components/server-form.tsx': "import {save} from '../actions/a'; export const F=()=>save",
      'src/features/a/components/a.tsx':
        "'use client'; import {useSave} from '../hooks/use-save'; import type {Dto} from '../services/a.server'",
      'src/features/a/hooks/use-save.ts':
        "'use client'; import {save} from '../actions/a'; export const useSave=()=>save",
      'src/features/a/actions/a.ts': "'use server'; import '../services/a.server'; export async function save(){}",
      'src/features/a/services/a.server.ts': "import 'server-only'; import '@/features/b'; export type Dto={id:string}",
      'src/features/b/index.ts': 'export const x=1',
    }),
    [],
  );
});
test('client closure cannot disguise a component service read behind a shared component', () => {
  assert.match(
    check({
      'src/features/a/components/client.tsx': "'use client'; import './shared'",
      'src/features/a/components/shared.tsx': "import '../services/browser'",
      'src/features/a/services/browser.ts': 'export const x=1',
    }).join('\n'),
    /Client-reachable presentation/,
  );
});
test('client mutations must go through a hook', () => {
  assert.match(
    check({
      'src/features/a/components/a.tsx': "'use client'; import {save} from '../actions/a'",
      'src/features/a/actions/a.ts': "'use server'; export async function save(){}",
    }).join('\n'),
    /Client mutations must use a hook/,
  );
  assert.match(
    check({
      'src/app/x/page.tsx': "'use client'; import {save} from '@/features/a/actions/a'",
      'src/features/a/actions/a.ts': "'use server'; export async function save(){}",
    }).join('\n'),
    /Client mutations must use a hook/,
  );
  assert.match(
    check({
      'src/features/a/components/client.tsx': "'use client'; import './shared'",
      'src/features/a/components/shared.tsx': "import {save} from '../actions/a'",
      'src/features/a/actions/a.ts': "'use server'; export async function save(){}",
    }).join('\n'),
    /presentation mutations must use a hook/,
  );
  assert.deepEqual(
    check({
      'src/features/a/components/a.tsx': "'use client'; import type {State} from '../actions/a'",
      'src/features/a/actions/a.ts': "'use server'; export type State={ok:boolean}",
    }),
    [],
  );
});
test('applications never import another application', () => {
  assert.match(
    check({
      'src/features/a/services/a.server.ts': "import {config} from '../../../../../api/src/platform/config'",
    }).join('\n'),
    /stay inside this application/,
  );
  assert.match(
    check({ 'src/lib/x.ts': "import type {X} from '../../../api/src/x'" }).join('\n'),
    /stay inside this application/,
  );
  assert.match(check({ 'src/lib/x.ts': "import '@repo/api'" }).join('\n'), /Applications are leaves/);
  assert.deepEqual(check({ 'src/lib/x.ts': "import '../app/y'", 'src/app/y.ts': 'export {}' }), []);
});
test('routes import a feature only through its index.ts', () => {
  assert.match(
    check({
      'src/app/page.tsx': "import '@/features/a/services/a.server'",
      'src/features/a/services/a.server.ts': "import 'server-only'",
    }).join('\n'),
    /only through its index\.ts/,
  );
  assert.match(
    check({
      'src/lib/x.ts': "import '../features/a/components/a'",
      'src/features/a/components/a.tsx': 'export {}',
    }).join('\n'),
    /only through its index\.ts/,
  );
  assert.deepEqual(
    check({ 'src/app/page.tsx': "import '@/features/a'", 'src/features/a/index.ts': 'export const x=1' }),
    [],
  );
});
test('Server Actions are only passed to form actions, never as props', () => {
  const action = { 'src/features/a/actions/a.ts': "'use server'; export async function save(){}" };
  assert.match(
    check({
      ...action,
      'src/features/a/components/page.tsx':
        "import {save} from '../actions/a'; export const P=()=><Editor onSave={save}/>",
    }).join('\n'),
    /only to <form action>/,
  );
  assert.match(
    check({
      ...action,
      'src/app/p/page.tsx':
        "import {save} from '@/features/a/actions/a'; export const P=()=><Editor run={save.bind(null,1)}/>",
    }).join('\n'),
    /only to <form action>/,
  );
  for (const element of [
    '<Editor action={save}/>',
    '<Editor formAction={save}/>',
    '<div action={save}/>',
    '<form formAction={save}/>',
  ])
    assert.match(
      check({
        ...action,
        'src/features/a/components/p.tsx': `import {save} from '../actions/a'; export const P=()=>${element}`,
      }).join('\n'),
      /only to <form action>/,
      element,
    );
  assert.deepEqual(
    check({
      ...action,
      'src/features/a/components/page.tsx':
        "import {save} from '../actions/a'; export const P=()=><form action={save}><button formAction={save}/></form>",
    }),
    [],
  );
});
test('NEXT_PUBLIC_ variables must be declared before use', () => {
  assert.match(
    check({ 'src/lib/x.ts': 'export const v=process.env.NEXT_PUBLIC_UNDECLARED' }).join('\n'),
    /NEXT_PUBLIC_UNDECLARED is inlined/,
  );
  assert.match(
    check({ 'src/lib/x.ts': "export const v=process.env['NEXT_PUBLIC_OTHER']" }).join('\n'),
    /NEXT_PUBLIC_OTHER is inlined/,
  );
  assert.deepEqual(
    inspectArchitecture(new Map([['src/lib/x.ts', 'export const v=process.env.NEXT_PUBLIC_OK']]), {
      publicEnv: ['NEXT_PUBLIC_OK'],
    }),
    [],
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('private project links use one delegated navigator instead of hydrating every list row', () => {
  const projectLink = new URL('../src/features/projects/components/project-link.tsx', import.meta.url);
  assert.equal(existsSync(projectLink), false);
  const page = readFileSync(new URL('../src/app/projects/page.tsx', import.meta.url), 'utf8');
  const detail = readFileSync(new URL('../src/app/projects/[id]/page.tsx', import.meta.url), 'utf8');
  const form = readFileSync(new URL('../src/features/projects/components/project-form.tsx', import.meta.url), 'utf8');
  const navigation = readFileSync(
    new URL('../src/features/projects/components/project-navigation.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(page + detail + form + navigation, /next\/link|ProjectLink|useLinkStatus/);
  assert.equal(page.match(/<ProjectNavigation/g)?.length, 1);
  assert.equal(detail.match(/<ProjectNavigation/g)?.length, 1);
  assert.match(page, /<a data-project-navigation href=\{'\/projects\/' \+ project\.id\}>/);
  assert.match(form, /<a data-project-navigation href=\{'\/projects\/' \+ state\.createdId\}>/);
  assert.match(navigation, /a\[data-project-navigation\]/);
  assert.match(navigation, /router\.push\(target\.pathname \+ target\.search \+ target\.hash\)/);
  assert.match(navigation, /if \(!pending\) return null/);
});

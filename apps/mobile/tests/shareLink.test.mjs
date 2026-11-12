import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { linkSharePlan } from '../src/lib/shareLinkPlan.ts';
const linkShare = (t, u, os) => linkSharePlan(os, t, u);

const U = 'https://txillapp.com/c/ABC';
test('a ligação vai uma só vez: à parte no iPhone e no browser, no fim do texto no Android', () => {
  assert.deepEqual(linkShare('Entra no Txillapp:', U, 'ios'), { message: 'Entra no Txillapp:', url: U });
  assert.deepEqual(linkShare('Entra no Txillapp:', U, 'web'), { message: 'Entra no Txillapp:', url: U });
  assert.deepEqual(linkShare('Entra no Txillapp:', U, 'android'), { message: `Entra no Txillapp: ${U}` });
  assert.deepEqual(linkShare('', U, 'ios'), { url: U });
  assert.deepEqual(linkShare('', U, 'android'), { message: U });
});

test('nenhuma partilha mete a ligação no texto e outra vez em url', () => {
  for (const f of ['components/ProfileView.tsx', 'components/ProfileQrSheet.tsx', 'components/PostSheets.tsx', 'components/ShareSheet.tsx', 'components/StoryParts.tsx', 'components/VenueQr.tsx', 'components/VenueTxills.tsx']) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /Share\.share\(\{[^)]*message:/, f);
    assert.match(src, /linkShare\(/, f);
  }
});

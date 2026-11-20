// O convite «Encontra amigos nos teus contactos» (lib/contactsNudge): de tempos a tempos, nunca insistente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const n = await import(new URL('../src/lib/contactsNudge.ts', import.meta.url).href);
const DAY = 86_400_000;
const ask = { status: 'undetermined', canAskAgain: true };

test('aparece logo a primeira vez; depois de «Agora não», só ao fim de 7, 21 e 45 dias; ao 4.º, nunca mais', () => {
  let s = n.emptyNudge();
  const t0 = 1_800_000_000_000;
  assert.equal(n.nudgeMode(s, ask, t0), 'ask');
  s = n.dismissNudge(s, 'ask', t0);
  assert.equal(n.nudgeMode(s, ask, t0 + 6 * DAY), null);
  assert.equal(n.nudgeMode(s, ask, t0 + 7 * DAY), 'ask');
  s = n.dismissNudge(s, 'ask', t0 + 7 * DAY);
  assert.equal(n.nudgeMode(s, ask, t0 + 27 * DAY), null);
  assert.equal(n.nudgeMode(s, ask, t0 + 28 * DAY), 'ask');
  s = n.dismissNudge(s, 'ask', t0 + 28 * DAY);
  assert.equal(n.nudgeMode(s, ask, t0 + 72 * DAY), null);
  assert.equal(n.nudgeMode(s, ask, t0 + 73 * DAY), 'ask');
  s = n.dismissNudge(s, 'ask', t0 + 73 * DAY);
  assert.equal(s.dismissed, 4);
  assert.equal(n.nudgeMode(s, ask, t0 + 400 * DAY), null);
});

test('com a permissão dada, nunca; recusada de vez, uma só vez para abrir as definições', () => {
  assert.equal(n.nudgeMode(n.emptyNudge(), { status: 'granted', canAskAgain: true }), null);
  const denied = { status: 'denied', canAskAgain: false };
  assert.equal(n.nudgeMode(n.emptyNudge(), denied), 'settings');
  assert.equal(n.nudgeMode(n.dismissNudge(n.emptyNudge(), 'settings'), denied), null);
  // Recusada mas ainda se pode pedir: segue o ritmo normal.
  assert.equal(n.nudgeMode(n.emptyNudge(), { status: 'denied', canAskAgain: true }), 'ask');
  assert.deepEqual(n.readNudge('lixo'), n.emptyNudge());
});

test('o cartão no Início, só na app instalada', () => {
  const c = readFileSync(new URL('../src/components/ContactsNudge.tsx', import.meta.url), 'utf8');
  assert.match(c, /if \(!nativeContacts \|\| !user\) return setMode\(null\);/);
  assert.match(c, /Linking\.openSettings\(\)/);
  assert.match(readFileSync(new URL('../src/app/(tabs)/index.tsx', import.meta.url), 'utf8'), /<ContactsNudge \/>/);
});

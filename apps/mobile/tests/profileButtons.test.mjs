import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('no meu perfil: o QR partilha com o convite e o «user+» abre as sugestões de malta', () => {
  const pv = read('components/ProfileView.tsx');
  assert.match(pv, /router\.push\('\/supertxill' as never\)\} hitSlop=\{ROW_SLOP\}[^>]*accessibilityLabel="Malta para ti: sugestões de amigos"/);
  assert.match(pv, /<ProfileQrSheet [^>]*invite=\{p\.isMe\}/);
  assert.doesNotMatch(pv, /inviteCrew/);
  const qr = read('components/ProfileQrSheet.tsx');
  assert.match(qr, /queryFn: api\.invites, enabled: invite/);
  assert.match(qr, /const url = link \|\| `\$\{origin\}\/u\/\$\{username\}`/);
});

test('o convite aberto por quem já tem conta vai direto ao perfil de quem convidou', () => {
  const c = read('app/c/[code].tsx');
  assert.match(c, /if \(p && user\) router\.replace\(`\/u\/\$\{p\.username\}` as never\)/);
});

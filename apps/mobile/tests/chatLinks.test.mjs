// Ligações e @menções nas bolhas do chat (src/lib/chatLinks.ts): antes o texto das mensagens era só texto (no site já
// eram ligações). As do Txillapp abrem dentro da app; as outras fora; @username abre o perfil.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const l = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'chatLinks.ts')).href);
const kinds = (s) => l.chatSegments(s).map((x) => `${x.t}:${x.s}`);

test('texto sem ligações nem menções fica num pedaço só', () => {
  assert.deepEqual(l.chatSegments('olá, tudo bem?'), [{ t: 'text', s: 'olá, tudo bem?' }]);
  assert.deepEqual(l.chatSegments(''), [{ t: 'text', s: '' }]);
});

test('ligações: a pontuação do fim fica de fora e só http(s)', () => {
  assert.deepEqual(kinds('vê isto: https://exemplo.co.mz/a/b?x=1. Fixe!'), ['text:vê isto: ', 'url:https://exemplo.co.mz/a/b?x=1', 'text:. Fixe!']);
  assert.deepEqual(kinds('(https://exemplo.com)'), ['text:(', 'url:https://exemplo.com', 'text:)']);
  assert.deepEqual(kinds('ftp://exemplo.com'), ['text:ftp://exemplo.com']);
  assert.deepEqual(kinds('https://user:senha@mau.com/x'), ['text:https://user:senha@mau.com/x']);
  assert.deepEqual(kinds('http://localhost/x'), ['text:http://localhost/x']);
});

test('as do Txillapp abrem dentro da app (só os ecrãs que existem); as outras abrem fora', () => {
  assert.deepEqual(l.chatUrl('https://txillapp.com/p/Ab3xK9q'), { href: 'https://txillapp.com/p/Ab3xK9q', path: '/p/Ab3xK9q' });
  assert.equal(l.chatUrl('https://www.txillapp.com/m/@sara').path, '/m/@sara');
  assert.equal(l.chatUrl('https://txillapp.com/c/ABC123?ref=x#y').path, '/c/ABC123?ref=x');
  assert.equal(l.chatUrl('https://TXILLAPP.com/u/sara').path, '/u/sara');
  assert.equal(l.chatUrl('https://txillapp.com/api/v1/x').path, null);
  assert.equal(l.chatUrl('https://txillapp.com').path, null);
  assert.equal(l.chatUrl('https://txillapp.com.mau.com/p/x').path, null);
  assert.equal(l.chatUrl('https://exemplo.com/p/x').path, null);
});

test('@menções: abrem o perfil; não contam em emails nem dentro de ligações; o ponto final fica de fora', () => {
  assert.deepEqual(l.chatSegments('olá @sara.m.'), [{ t: 'text', s: 'olá ' }, { t: 'mention', s: '@sara.m', username: 'sara.m' }, { t: 'text', s: '.' }]);
  assert.deepEqual(kinds('escreve para a@b.com'), ['text:escreve para a@b.com']);
  assert.deepEqual(kinds('@jo'), ['text:@jo']);
  assert.deepEqual(kinds('https://txillapp.com/m/@sara e @ana_1'), ['url:https://txillapp.com/m/@sara', 'text: e ', 'mention:@ana_1']);
});

test('as bolhas de texto e as legendas usam isto', () => {
  const src = readFileSync(path.join(ROOT, 'src/components/ChatBubbles.tsx'), 'utf8');
  assert.match(src, /chatSegments\(/);
  assert.match(src, /<ChatText text=\{shown\}/);
  assert.match(src, /<ChatText text=\{m\.body\}/);
});

test('números de telefone: detetados, prontos a marcar, sem confundir valores, datas e códigos', () => {
  const phones = (t) => l.chatSegments(t).filter((s) => s.t === 'phone').map((s) => `${s.s}=${s.tel}`);
  assert.deepEqual(phones('liga 84 123 4567 já'), ['84 123 4567=+258841234567']);
  assert.deepEqual(phones('+258 84-123-4567.'), ['+258 84-123-4567=+258841234567']);
  assert.deepEqual(phones('00258841234567'), ['00258841234567=+258841234567']);
  assert.deepEqual(phones('(+351) 912 345 678'), ['(+351) 912 345 678=+351912345678']);
  assert.deepEqual(phones('@joao 871234567'), ['871234567=+258871234567']);
  for (const no of ['custa 1 500 000 mt', 'dia 2026-11-13 10:00', 'nasci a 13.11.2026', 'código 1234567890123456', '12,345,678.90', '111111111', 'a@b.com 12345678', 'https://x.com/841234567'])
    assert.deepEqual(phones(no), [], no);
  const src = readFileSync(path.join(ROOT, 'src/components/ChatBubbles.tsx'), 'utf8');
  assert.match(src, /<PhoneSheet /);
  const sheet = readFileSync(path.join(ROOT, 'src/components/PhoneSheet.tsx'), 'utf8');
  for (const s of ['tel:', 'sms:', 'wa.me/', 'Copiar número']) assert.ok(sheet.includes(s), s);
});

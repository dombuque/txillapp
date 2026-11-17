// Oferecer vibes na Txillada tem de ser fácil: um botão «Oferecer» com o nome escrito ao lado do comentário, a meta da
// Angariação com «Ajudar», e na folha um toque num valor oferece logo (sem escolher e depois confirmar).
// Correr em apps/mobile:  node --test tests/txilladaOferecer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
const screen = read('app', 'txillada', '[id].tsx');
const money = read('components', 'txillada', 'TxilladaMoney.tsx');

test('o botão «Oferecer» fica ao lado do comentário, com o presente e o nome escrito', () => {
  assert.match(screen, /ui\.canGift && !typing \? \([\s\S]*?st\.offer[\s\S]*?<Icon name="gift"[\s\S]*?>\{t\('Oferecer'\)\}<\/Text>/);
  assert.doesNotMatch(screen, /<Icon name="present"/);
  assert.doesNotMatch(screen, /st\.giftBtn/);
});

test('a meta da Angariação tem «Ajudar», que abre a folha', () => {
  assert.match(screen, /<GoalBar [^>]*onGive=\{ui\.canGift \? \(\) => setPanel\('gift'\) : undefined\}/);
  assert.match(money, /onGive \? \([\s\S]*?>\{t\('Ajudar'\)\}<\/Text>/);
});

test('na folha, um toque num valor oferece logo e a folha fica aberta para dar mais', () => {
  assert.match(money, /onPress=\{\(\) => void give\(v, v\)\}/);
  assert.match(money, /Toca num valor e já está\./);
  assert.match(money, /Toca de novo para dar mais\./);
  assert.doesNotMatch(screen, /onDone=\{\(n\) => \{ setPanel\(null\)/);
});

test('100 vibes ou mais pedem confirmação («Oferecer 100 vibes a @x?»); abaixo, um toque e já está', () => {
  const lib = read('lib', 'txillada.ts');
  assert.match(lib, /export const GIFT_CONFIRM_FROM = 100;/);
  assert.match(lib, /export const giftNeedsConfirm = \(n: number\): boolean => n >= GIFT_CONFIRM_FROM;/);
  // Na folha: depois da validação e antes de enviar, só quando o valor chega aos 100 (num valor ou em «Outro valor»).
  assert.match(money, /if \(bad\) \{[^\n]*\n    if \(giftNeedsConfirm\(amount\)\) \{[\s\S]*?await confirm\(\{ title: t\('Oferecer \{txillsLabel\} a @\{host\}\?', \{ txillsLabel: txillsLabel\(amount\), host \}\)[\s\S]*?if \(!ok\) return;\n    \}\n    setBusy\(from\);\n    setErr\(null\);\n    const r = await onSend\(amount\);/);
  // O 100 é o único valor pronto que pede confirmação; os outros continuam a um toque.
  const presets = [...lib.match(/GIFT_PRESETS = \[([^\]]+)\]/)[1].matchAll(/\d+/g)].map(Number);
  assert.deepEqual(presets.filter((v) => v >= 100), [100]);
});

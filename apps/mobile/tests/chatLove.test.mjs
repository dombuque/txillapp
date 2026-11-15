// Testes do coração do duplo toque nas mensagens (src/lib/chatLove.ts) e de como a bolha o liga
// (components/ChatBubbles.tsx): o coração é a reação «Adorar» (:amor:), já posto não se tira, o toque simples continua a
// mostrar a hora, segurar continua a abrir o menu e deslizar continua a responder; no computador é o duplo clique.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const l = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'chatLove.ts')).href);
const read = (f) => readFileSync(path.join(ROOT, 'src', ...f.split('/')), 'utf8').replace(/\r\n/g, '\n');

test('o coração é a reação «Adorar» que o menu já tem (o servidor aceita :nome:)', () => {
  assert.equal(l.LOVE_REACTION, ':amor:');
  assert.match(l.LOVE_REACTION, /^:[a-z]{2,12}:$/);
  assert.match(read('components/StoryParts.tsx'), /\{ id: ':amor:', label: 'Adorar'/);
});

test('canLove: só nas mensagens enviadas, não apagadas, não de ver uma vez, nem avisos de sistema', () => {
  assert.equal(l.canLove({ id: 'a1', kind: 'text' }), true);
  assert.equal(l.canLove({ id: 'a1', kind: 'image' }), true);
  assert.equal(l.canLove({ id: 'tmp-1', kind: 'text' }), false);
  assert.equal(l.canLove({ id: 'a1', kind: 'text', state: 'sending' }), false);
  assert.equal(l.canLove({ id: 'a1', kind: 'text', state: 'failed' }), false);
  assert.equal(l.canLove({ id: 'a1', kind: 'text', deleted: true }), false);
  assert.equal(l.canLove({ id: 'a1', kind: 'voice', viewOnce: true }), false);
  assert.equal(l.canLove({ id: 'a1', kind: 'system' }), false);
});

test('lovedByMe: só a minha reação de coração conta', () => {
  assert.equal(l.lovedByMe({ id: 'a', reactions: [{ reaction: ':amor:', count: 2, mine: true }] }), true);
  assert.equal(l.lovedByMe({ id: 'a', reactions: [{ reaction: ':amor:', count: 2, mine: false }] }), false);
  assert.equal(l.lovedByMe({ id: 'a', reactions: [{ reaction: ':rir:', count: 1, mine: true }] }), false);
  assert.equal(l.lovedByMe({ id: 'a' }), false);
});

test('withLove: sem reações, passa a um coração meu', () => {
  assert.deepEqual(l.withLove(undefined), [{ reaction: ':amor:', count: 1, mine: true }]);
  assert.deepEqual(l.withLove([]), [{ reaction: ':amor:', count: 1, mine: true }]);
});

test('withLove: junta-se ao coração dos outros', () => {
  assert.deepEqual(l.withLove([{ reaction: ':amor:', count: 2, mine: false }]), [{ reaction: ':amor:', count: 3, mine: true }]);
});

test('withLove: a minha outra reação passa a coração (uma por pessoa); a dos outros fica', () => {
  assert.deepEqual(l.withLove([{ reaction: ':rir:', count: 1, mine: true }]), [{ reaction: ':amor:', count: 1, mine: true }]);
  assert.deepEqual(l.withLove([{ reaction: ':rir:', count: 3, mine: true }, { reaction: ':amor:', count: 1, mine: false }]), [
    { reaction: ':rir:', count: 2, mine: false },
    { reaction: ':amor:', count: 2, mine: true },
  ]);
});

test('applyLoveToPages: só muda a mensagem certa; dados estranhos ficam como estão', () => {
  const data = { pages: [{ items: [{ id: 'a', reactions: [] }, { id: 'b' }] }, { items: [{ id: 'c' }] }], pageParams: [undefined, 'x'] };
  const out = l.applyLoveToPages(data, 'b');
  assert.deepEqual(out.pages[0].items[1].reactions, [{ reaction: ':amor:', count: 1, mine: true }]);
  assert.deepEqual(out.pages[0].items[0].reactions, []);
  assert.equal(out.pages[1].items[0].reactions, undefined);
  assert.deepEqual(out.pageParams, [undefined, 'x']);
  assert.equal(data.pages[0].items[1].reactions, undefined, 'não muda o original');
  assert.equal(l.applyLoveToPages(undefined, 'b'), undefined);
  assert.deepEqual(l.applyLoveToPages({ x: 1 }, 'b'), { x: 1 });
});

test('duplo clique no computador: o segundo clique (detail 2)', () => {
  assert.equal(l.isDoubleClick(2), true);
  for (const d of [0, 1, 3, undefined, '2']) assert.equal(l.isDoubleClick(d), false);
});

test('a animação: cresce, assenta, sobe e desaparece; com "reduzir movimento" não cresce nem sobe', () => {
  const f = l.loveFrames(false);
  for (const k of ['scale', 'opacity', 'lift']) assert.equal(f[k].length, f.input.length);
  assert.deepEqual([f.input[0], f.input.at(-1)], [0, 1]);
  assert.ok(Math.max(...f.scale) > 1, 'salta acima do tamanho');
  assert.equal(f.opacity[0], 0);
  assert.equal(f.opacity.at(-1), 0);
  assert.ok(f.lift.at(-1) < 0, 'sobe');
  const r = l.loveFrames(true);
  assert.ok(r.scale.every((x) => x === 1));
  assert.ok(r.lift.every((x) => x === 0));
  assert.equal(r.opacity.at(-1), 0);
  assert.ok(l.LOVE_BURST_MS >= 500 && l.LOVE_BURST_MS <= 1200);
  assert.ok(l.LOVE_TAP_MS >= 200 && l.LOVE_TAP_MS <= 350);
});

const BUBBLES = read('components/ChatBubbles.tsx');

test('a bolha: dois toques põem o coração; o toque simples espera e mostra a hora; o segurar e o deslizar ficam', () => {
  // O segundo toque dentro da janela põe o coração (no telemóvel); o primeiro só mostra a hora depois de LOVE_TAP_MS.
  assert.match(BUBBLES, /if \(tapTimer\.current\) \{\n\s+clearTimeout\(tapTimer\.current\);\n\s+tapTimer\.current = null;\n[^\n]*\n\s+if \(lovable && !desk\) love\(\);/);
  assert.match(BUBBLES, /setShowTime\(\(v\) => !v\);\n\s+\}, LOVE_TAP_MS\);/);
  // Segurar (menu) e deslizar (responder) continuam ligados na mesma bolha.
  assert.match(BUBBLES, /\{\.\.\.hold\}\n\s+onPress=\{onPress\}\n\s+\{\.\.\.deskLove\}/);
  assert.match(BUBBLES, /<ReplySwipe\n\s+enabled=\{swipe && !desk\}/);
  // Nunca tira: o ecrã só chama o servidor se ainda não for meu (components/ChatParts, loveMessage).
  assert.match(read('components/ChatParts.tsx'), /export async function loveMessage[\s\S]*?if \(lovedByMe\(m\)\) return;[\s\S]*?api\.chatReact\(m\.id, LOVE_REACTION\)/);
  assert.doesNotMatch(read('components/ChatParts.tsx').match(/export async function loveMessage[\s\S]*?\n\}/)[0], /unreact/);
});

test('a bolha: o coração salta por cima (sem apanhar toques), vibra no telemóvel e, no computador, é o duplo clique', () => {
  assert.match(BUBBLES, /function LoveBurst\(/);
  assert.match(BUBBLES, /<View pointerEvents="none" style=\{st\.loveWrap\}/);
  assert.match(BUBBLES, /Haptics\.impactAsync\(Haptics\.ImpactFeedbackStyle\.Light\)/);
  assert.match(BUBBLES, /onMouseDown: [^\n]*isDoubleClick\(e\.nativeEvent\.detail\)[^\n]*e\.preventDefault\?\.\(\); love\(\);/);
  assert.match(BUBBLES, /\{burst \? <LoveBurst key=\{burst\}/);
});

test('as duas conversas (a dois e TxillGroup) ligam o coração; já não há o brinde do duplo toque', () => {
  for (const f of ['app/messages/[username].tsx', 'app/messages/g/[id].tsx']) {
    const s = read(f);
    assert.match(s, /onLove=\{\(m\) => void love\(m\)\}/, f);
    assert.match(s, /loveMessage\(qc, /, f);
    assert.doesNotMatch(s, /onCheer=/, f);
  }
  assert.match(read('components/ChatList.tsx'), /onLove=\{onLove\}/);
});

// Testes do deslizar uma bolha para a direita para responder (src/lib/replySwipe.ts): a resistência, o limiar,
// a borda do ecrã, a decisão da web entre "é da bolha" e "é rolar", e que mensagens deslizam.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'replySwipe.ts')).href);

test('os números do gesto: arranque 14, desiste a 8 na vertical, limiar 56 abaixo do máximo 72, borda 24', () => {
  assert.ok(r.REPLY_START_X >= 14);
  assert.ok(r.REPLY_FAIL_Y >= 8 && r.REPLY_FAIL_Y <= 10);
  assert.equal(r.REPLY_TRIGGER, 56);
  assert.equal(r.REPLY_MAX, 72);
  assert.ok(r.REPLY_TRIGGER < r.REPLY_MAX);
  assert.equal(r.REPLY_EDGE, 24);
});

test('replyPull: para a esquerda (ou nada) não sai do sítio', () => {
  assert.equal(r.replyPull(0), 0);
  assert.equal(r.replyPull(-30), 0);
  assert.equal(r.replyPull(Number.NaN), 0);
});

test('replyPull: no início segue o dedo à letra', () => {
  for (const d of [1, 10, 25, 40]) assert.equal(r.replyPull(d), d);
});

test('replyPull: depois custa mais, cresce sempre e nunca passa o máximo', () => {
  let prev = r.replyPull(40);
  for (let d = 41; d <= 600; d += 7) {
    const v = r.replyPull(d);
    assert.ok(v > prev, `cresce em ${d}`);
    assert.ok(v < d, `resistência em ${d}`);
    assert.ok(v <= r.REPLY_MAX, `máximo em ${d}`);
    prev = v;
  }
  assert.ok(r.replyPull(10_000) <= r.REPLY_MAX);
  assert.ok(r.replyPull(10_000) > r.REPLY_MAX - 0.5);
});

test('replyPull: o limiar alcança-se com um deslize normal (menos de ~80 pt de dedo)', () => {
  let d = 0;
  while (!r.replyArmed(r.replyPull(d))) d++;
  assert.ok(d > r.REPLY_TRIGGER && d < 80, `precisa de ${d} pt`);
});

test('replyArmed e replyProgress: abaixo do limiar não responde; o ícone vai de 0 a 1 até lá', () => {
  assert.equal(r.replyArmed(55.9), false);
  assert.equal(r.replyArmed(56), true);
  assert.equal(r.replyArmed(72), true);
  assert.equal(r.replyProgress(0), 0);
  assert.equal(r.replyProgress(-5), 0);
  assert.equal(r.replyProgress(28), 0.5);
  assert.equal(r.replyProgress(56), 1);
  assert.equal(r.replyProgress(72), 1);
});

test('fromLeftEdge: os primeiros 24 pt da borda esquerda são do voltar do sistema', () => {
  assert.equal(r.fromLeftEdge(0), true);
  assert.equal(r.fromLeftEdge(23), true);
  assert.equal(r.fromLeftEdge(24), false);
  assert.equal(r.fromLeftEdge(200), false);
});

test('replyLock (web): espera os primeiros px, e só é da bolha se for claramente para a direita', () => {
  assert.equal(r.replyLock(5, 3), 'wait');
  assert.equal(r.replyLock(9, -9), 'wait');
  assert.equal(r.replyLock(20, 2), 'reply');
  assert.equal(r.replyLock(15, 9), 'reply');
  // Para cima/baixo, na diagonal ou para a esquerda: fica com o browser (rolar, selecionar texto).
  assert.equal(r.replyLock(2, 20), 'off');
  assert.equal(r.replyLock(12, 10), 'off');
  assert.equal(r.replyLock(-20, 0), 'off');
  // O browser já começou a rolar (o toque deixou de ser cancelável): é rolar.
  assert.equal(r.replyLock(20, 2, false), 'off');
});

test('canSwipeReply: só mensagens já enviadas, não apagadas, nem de sistema, nem vídeo com leitor', () => {
  const base = { id: '0190a', kind: 'text', mediaUrl: null };
  assert.equal(r.canSwipeReply(base), true);
  assert.equal(r.canSwipeReply({ ...base, kind: 'image', mediaUrl: '/m/1' }), true);
  assert.equal(r.canSwipeReply({ ...base, kind: 'voice' }), true);
  assert.equal(r.canSwipeReply({ ...base, kind: 'sticker' }), true);
  assert.equal(r.canSwipeReply({ ...base, kind: 'video', viewOnce: true, mediaUrl: null }), true);
  assert.equal(r.canSwipeReply({ ...base, id: 'tmp-123' }), false);
  assert.equal(r.canSwipeReply({ ...base, state: 'sending' }), false);
  assert.equal(r.canSwipeReply({ ...base, state: 'failed' }), false);
  assert.equal(r.canSwipeReply({ ...base, deleted: true }), false);
  assert.equal(r.canSwipeReply({ ...base, deletedAt: '2026-11-11T10:00:00Z' }), false);
  assert.equal(r.canSwipeReply({ ...base, kind: 'call' }), false);
  assert.equal(r.canSwipeReply({ ...base, kind: 'system' }), false);
  assert.equal(r.canSwipeReply({ ...base, kind: 'video', mediaUrl: '/m/2' }), false);
});

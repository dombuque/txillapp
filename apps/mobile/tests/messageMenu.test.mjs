// Testes do menu de uma mensagem (src/lib/messageMenu.ts): que opções aparecem (minha/outra, tempo e tipo), a folha
// "Apagar mensagem?", o que muda logo na conversa ao apagar e ao editar, o segurar da web e as ações do leitor de ecrã.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'messageMenu.ts')).href);

const NOW = Date.parse('2026-11-11T12:00:00Z');
const ago = (min) => new Date(NOW - min * 60_000).toISOString();
const msg = (o = {}) => ({ id: '018f0000-0000-7000-8000-000000000001', fromMe: true, kind: 'text', body: 'olá', at: ago(1), ...o });

test('as minhas: apagar para todos e para mim; editar a de texto; sem denunciar', () => {
  const o = r.messageOptions(msg(), NOW);
  assert.deepEqual(o, { react: true, reply: true, copy: true, edit: true, deleteForMe: true, deleteForAll: true, report: false });
  assert.deepEqual(r.deleteChoices(o), ['all', 'me']);
});

test('as da outra pessoa: só apagar para mim (nunca para todos), denunciar, sem editar', () => {
  const o = r.messageOptions(msg({ fromMe: false }), NOW);
  assert.equal(o.deleteForAll, false);
  assert.equal(o.deleteForMe, true);
  assert.equal(o.report, true);
  assert.equal(o.edit, false);
  assert.deepEqual(r.deleteChoices(o), ['me']);
});

test('apagar para todos: sem limite de tempo (a regra do servidor); com limite, só dentro dele', () => {
  assert.equal(r.DELETE_FOR_ALL_LIMIT_MS, null);
  assert.equal(r.canDeleteForAll(msg({ at: ago(60 * 24 * 30) }), NOW), true);
  const hour = 60 * 60_000;
  assert.equal(r.canDeleteForAll(msg({ at: ago(30) }), NOW, hour), true);
  assert.equal(r.canDeleteForAll(msg({ at: ago(61) }), NOW, hour), false);
  assert.equal(r.canDeleteForAll(msg({ at: 'não é data' }), NOW, hour), false);
});

test('editar: só as minhas de texto, nos primeiros 15 minutos', () => {
  assert.equal(r.EDIT_WINDOW_MS, 15 * 60_000);
  assert.equal(r.canEdit(msg({ at: ago(14) }), NOW), true);
  assert.equal(r.canEdit(msg({ at: ago(16) }), NOW), false);
  assert.equal(r.canEdit(msg({ fromMe: false }), NOW), false);
  for (const kind of ['image', 'voice', 'video', 'sticker', 'location', 'gift', 'post', 'call', 'story_reply', 'zas_reply', 'poll']) {
    assert.equal(r.canEdit(msg({ kind }), NOW), false, kind);
  }
  assert.equal(r.canEdit(msg({ viewOnce: true }), NOW), false);
  assert.equal(r.canEdit(msg({ deleted: true }), NOW), false);
  assert.equal(r.canEdit(msg({ body: 'Em resposta à tua nota “praia?”: bora' }), NOW), false);
});

test('todos os tipos (minhas e dos outros) têm "Apagar"; os de sistema não se respondem nem denunciam', () => {
  for (const kind of ['text', 'image', 'video', 'voice', 'sticker', 'location', 'gift', 'post', 'call', 'story_reply', 'story_reaction', 'zas_reply', 'poll']) {
    for (const fromMe of [true, false]) {
      const o = r.messageOptions(msg({ kind, fromMe }), NOW);
      assert.equal(o.deleteForMe, true, `${kind} ${fromMe}`);
      assert.equal(o.deleteForAll, fromMe, `${kind} ${fromMe}`);
    }
  }
  const call = r.messageOptions(msg({ kind: 'call', fromMe: false }), NOW);
  assert.equal(call.reply, false);
  assert.equal(call.report, false);
});

test('copiar: só texto (a foto, a legenda); nada na visualização única; numa resposta a nota, só a resposta', () => {
  assert.equal(r.messageOptions(msg({ kind: 'image', body: '' }), NOW).copy, false);
  assert.equal(r.messageOptions(msg({ kind: 'image', body: 'praia' }), NOW).copy, true);
  assert.equal(r.messageOptions(msg({ kind: 'sticker', body: 'bora' }), NOW).copy, false);
  assert.equal(r.messageOptions(msg({ viewOnce: true, body: '' }), NOW).copy, false);
  assert.equal(r.copyText({ kind: 'text', body: 'Em resposta à tua nota “praia?”: bora' }), 'bora');
});

test('apagada para todos: só "Apagar para mim" (tirar o aviso); a enviar ou falhada: nada', () => {
  const gone = r.messageOptions(msg({ deleted: true, fromMe: false }), NOW);
  assert.deepEqual(gone, { react: false, reply: false, copy: false, edit: false, deleteForMe: true, deleteForAll: false, report: false });
  assert.deepEqual(r.deleteChoices(r.messageOptions(msg({ deleted: true }), NOW)), ['me']);
  assert.ok(Object.values(r.messageOptions(msg({ id: 'tmp-1' }), NOW)).every((v) => v === false));
  assert.ok(Object.values(r.messageOptions(msg({ state: 'failed' }), NOW)).every((v) => v === false));
  assert.equal(r.deletedText(true), 'Apagaste esta mensagem');
  assert.equal(r.deletedText(false), 'Esta mensagem foi apagada');
});

test('otimista: para mim sai da conversa; para todos fica o aviso e as respostas citam "apagada"', () => {
  const items = [
    { id: 'c', fromMe: false, kind: 'text', body: 'resposta', replyTo: { id: 'a', gone: false, body: 'segredo' } },
    { id: 'b', fromMe: false, kind: 'text', body: 'outra' },
    { id: 'a', fromMe: true, kind: 'location', body: 'Casa', lat: 38.7, lng: -9.1, mediaUrl: null, reactions: [{ reaction: ':amor:', count: 1, mine: false }] },
  ];
  assert.deepEqual(r.applyDeletion(items, 'b', 'me').map((m) => m.id), ['c', 'a']);
  const all = r.applyDeletion(items, 'a', 'all');
  assert.deepEqual(all[2], { ...items[2], deleted: true, kind: 'text', body: 'Apagaste esta mensagem', viewOnce: false, opened: false, storyUrl: null, mediaUrl: null, durationMs: null, waveform: null, lat: null, lng: null, giftAmount: null, post: undefined, poll: undefined, live: false, liveUntil: null, replyTo: null, reactions: [] });
  assert.deepEqual(all[0].replyTo, { id: 'a', gone: true });
  assert.equal(all[1], items[1]); // as outras ficam iguais (mesma referência)

  const data = { pages: [{ items: items.slice(0, 2), nextCursor: 'x' }, { items: items.slice(2), nextCursor: null }], pageParams: [undefined, 'x'] };
  const after = r.applyDeletionToPages(data, 'a', 'me');
  assert.deepEqual(after.pages.map((p) => p.items.length), [2, 0]);
  assert.equal(after.pages[0].nextCursor, 'x');
  assert.deepEqual(after.pageParams, data.pageParams);
  assert.equal(r.applyDeletionToPages(undefined, 'a', 'me'), undefined);
});

test('otimista ao editar: o texto novo (sem espaços à volta) e "editada"', () => {
  const data = { pages: [{ items: [{ id: 'a', fromMe: true, body: 'velho' }, { id: 'b', fromMe: false, body: 'outro' }] }] };
  const after = r.applyEditToPages(data, 'a', '  novo ');
  assert.deepEqual(after.pages[0].items[0], { id: 'a', fromMe: true, body: 'novo', edited: true });
  assert.equal(after.pages[0].items[1], data.pages[0].items[1]);
});

test('segurar: o tempo, a folga do dedo e só uma vez por toque', () => {
  assert.ok(r.HOLD_MS >= 350 && r.HOLD_MS <= 500);
  assert.equal(r.holdStill(6, 7), true);
  assert.equal(r.holdStill(9, 9), false);
  assert.equal(r.recentlyHeld(0, NOW), false);
  assert.equal(r.recentlyHeld(NOW - 200, NOW), true);
  assert.equal(r.recentlyHeld(NOW - r.HOLD_DEDUP_MS - 1, NOW), false);
});

test('leitor de ecrã: Responder, Apagar e Mais opções (nomes livres, não são accessibilityRole)', () => {
  assert.deepEqual(r.bubbleA11yActions({ reply: true, remove: true, menu: true }).map((a) => [a.name, a.label]), [['reply', 'Responder'], ['delete', 'Apagar'], ['longpress', 'Mais opções']]);
  assert.deepEqual(r.bubbleA11yActions({ reply: false, remove: true, menu: true }).map((a) => a.name), ['delete', 'longpress']);
  assert.deepEqual(r.bubbleA11yActions({ reply: false, remove: false, menu: false }), []);
});

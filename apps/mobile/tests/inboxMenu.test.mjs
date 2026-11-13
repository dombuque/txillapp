// Testes das ações de uma linha da lista de Mensagens (src/lib/inboxMenu.ts): o que aparece ao deslizar, na folha de
// segurar e no leitor de ecrã, em cada tipo de linha (conversa a dois ou TxillGroup) e em cada estado (lida, por ler).
// E o ecrã (app/(tabs)/messages.tsx, components/SwipeRow.tsx): segurar está ligado nos dois tipos de linha, sem chocar com deslizar.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'inboxMenu.ts')).href);
const src = (p) => readFileSync(path.join(ROOT, 'src', ...p.split('/')), 'utf8');

const chat = (o = {}) => ({ group: false, unread: 0, username: 'ana', me: 'eu', ...o });
const group = (o = {}) => ({ group: true, unread: 0, me: 'eu', ...o });
const labels = (items) => items.map((i) => i.label);

test('conversa lida: deslizar mostra "Por ler" e "Apagar"; a folha marca como por ler, vê o perfil, apaga e cancela', () => {
  assert.deepEqual(m.inboxSwipe(chat()), { left: ['unread'], right: ['delete'] });
  assert.deepEqual(m.inboxMenu(chat()), ['unread', 'profile', 'delete']);
  assert.deepEqual(labels(m.inboxMenuItems(chat())), ['Marcar como por ler', 'Ver perfil', 'Mensagens temporárias', 'Limpar conversa', 'Apagar conversa', 'Cancelar']);
  assert.equal(m.swipeLabel('unread'), 'Por ler');
  assert.equal(m.swipeLabel('delete'), 'Apagar');
});

test('conversa por ler (mensagens novas ou marcada à mão): "Marcar como lida" em vez de "por ler"', () => {
  assert.deepEqual(m.inboxSwipe(chat({ unread: 3 })).left, ['read']);
  assert.deepEqual(labels(m.inboxMenuItems(chat({ unread: 1 }))), ['Marcar como lida', 'Ver perfil', 'Mensagens temporárias', 'Limpar conversa', 'Apagar conversa', 'Cancelar']);
  assert.equal(m.swipeLabel('read'), 'Lida');
});

test('segurar a conversa: todas as opções do computador; limpar e apagar a vermelho; "Cancelar" sempre no fim', () => {
  const items = m.inboxMenuItems(chat());
  assert.deepEqual(items.filter((i) => i.danger).map((i) => i.id), ['clear', 'delete']);
  assert.equal(items.at(-1).id, 'cancel');
  assert.equal(items.at(-1).danger, false);
});

test('TxillGroup sem por ler: sem "lido"; info do grupo e sair (vermelho)', () => {
  assert.deepEqual(m.inboxSwipe(group()), { left: [], right: ['leave'] });
  assert.deepEqual(labels(m.inboxMenuItems(group())), ['Info do grupo', 'Sair do grupo', 'Cancelar']);
  assert.deepEqual(m.inboxMenuItems(group()).filter((i) => i.danger).map((i) => i.id), ['leave']);
});

test('TxillGroup com por ler: "Marcar como lido" (masculino) primeiro; nunca "por ler", ver perfil nem apagar', () => {
  assert.deepEqual(m.inboxSwipe(group({ unread: 2 })), { left: ['read'], right: ['leave'] });
  assert.deepEqual(labels(m.inboxMenuItems(group({ unread: 2 }))), ['Marcar como lido', 'Info do grupo', 'Sair do grupo', 'Cancelar']);
  for (const u of [0, 5]) {
    const acts = m.inboxMenu(group({ unread: u }));
    assert.ok(!acts.includes('unread') && !acts.includes('profile') && !acts.includes('delete'));
  }
});

test('sem sessão não se sai do grupo; conversa sem @ não tem ações (nem folha)', () => {
  assert.deepEqual(m.inboxMenu(group({ me: null })), ['info']);
  assert.deepEqual(m.inboxSwipe(group({ me: undefined })).right, []);
  assert.deepEqual(m.inboxMenu(chat({ username: undefined })), []);
  assert.deepEqual(m.inboxSwipe(chat({ username: undefined })), { left: [], right: [] });
  assert.deepEqual(m.inboxA11yActions(chat({ username: undefined })), []);
});

test('a folha mostra tudo o que o deslizar mostra (o mesmo estado, as mesmas ações)', () => {
  for (const r of [chat(), chat({ unread: 4 }), group(), group({ unread: 1 }), group({ me: null })]) {
    const s = m.inboxSwipe(r);
    const menu = m.inboxMenu(r);
    for (const a of [...s.left, ...s.right]) assert.ok(menu.includes(a), `${a} falta na folha`);
  }
});

test('leitor de ecrã: as ações da folha (sem "Cancelar") e "Mais opções" (longpress) no fim', () => {
  assert.deepEqual(m.inboxA11yActions(chat()), [
    { name: 'unread', label: 'Marcar como por ler' },
    { name: 'profile', label: 'Ver perfil' },
    { name: 'delete', label: 'Apagar conversa' },
    { name: 'longpress', label: 'Mais opções' },
  ]);
  assert.deepEqual(m.inboxA11yActions(group({ unread: 1 })).map((a) => a.name), ['read', 'info', 'leave', 'longpress']);
  assert.ok(m.inboxA11yActions(group()).every((a) => a.name !== 'cancel'));
});

test('leitor de ecrã: o nome volta para a ação; "longpress" abre a folha; o que não está na linha não faz nada', () => {
  assert.equal(m.a11yToAction('longpress', chat()), 'more');
  assert.equal(m.a11yToAction('delete', chat()), 'delete');
  assert.equal(m.a11yToAction('read', chat()), null); // está lida: só "por ler"
  assert.equal(m.a11yToAction('read', group({ unread: 2 })), 'read');
  assert.equal(m.a11yToAction('read', group()), null);
  assert.equal(m.a11yToAction('delete', group()), null);
  assert.equal(m.a11yToAction('activate', chat()), null);
  assert.equal(m.a11yToAction('longpress', chat({ username: undefined })), null);
});

test('web, contextmenu: o rato abre sempre; segurar no Android não abre outra vez a folha', () => {
  assert.equal(m.contextMenuOpens(10_000, false, false), true); // botão direito, sem toque recente
  assert.equal(m.contextMenuOpens(10_000, true, false), true);
  assert.equal(m.contextMenuOpens(600, true, false), false); // a folha já abriu pelo temporizador
  assert.equal(m.contextMenuOpens(300, false, true), false); // o temporizador ainda vai abri-la
  assert.equal(m.contextMenuOpens(600, false, false), true); // o temporizador desistiu, mas o browser achou que era segurar
});

test('o ícone de cada ação existe na biblioteca Tx', () => {
  const tx = src('icons/tx.ts');
  for (const a of ['read', 'unread', 'profile', 'delete', 'info', 'leave']) assert.ok(tx.includes(`"${m.actionIcon(a)}":`), m.actionIcon(a));
  assert.ok(tx.includes('"x":'));
});

test('ecrã: as duas linhas (conversa e GroupCard) seguram, com as ações do leitor de ecrã, e o SwipeRow recebe onHold', () => {
  const s = src('app/(tabs)/messages.tsx');
  assert.match(s, /<SwipeRow [^>]*onHold=\{hold\}/);
  assert.equal(s.match(/\{\.\.\.rowHold\(hold\)\}/g)?.length, 2);
  assert.match(s, /<GroupCard [^\n]*accessibilityActions=\{a11y\}[^\n]*onAccessibilityAction=/);
  assert.match(s, /accessibilityActions=\{a11y\.length \? a11y : undefined\}/);
  // A vibração é só no telemóvel.
  assert.match(s, /buzz && Platform\.OS !== 'web'\) void Haptics\.impactAsync\(Haptics\.ImpactFeedbackStyle\.Light\)/);
  // Deslizar e segurar correm as mesmas funções.
  assert.match(s, /onPress: \(\) => runAction\(a, r\)/);
  assert.match(s, /else runAction\(a, r\)/);
  const g = src('components/groups/GroupCard.tsx');
  assert.match(g, /onLongPress=\{p\.onLongPress\}/);
  assert.match(g, /onAccessibilityAction=\{p\.onAccessibilityAction/);
});

test('SwipeRow: segurar não choca com deslizar (web: desiste ao mexer, fecha a linha, contextmenu, sem seleção nem menu do Safari)', () => {
  const s = src('components/SwipeRow.tsx');
  assert.match(s, /!holdStill\(h\.clientX - hold\.x0, h\.clientY - hold\.y0\)\) dropHold\(\)/);
  assert.match(s, /dropHold\(\); \/\/ a linha apanhou o gesto/);
  assert.match(s, /el\.addEventListener\('contextmenu', context\)/);
  assert.match(s, /e\.preventDefault\(\);\s+if \(!contextMenuOpens/);
  assert.match(s, /css\.webkitTouchCallout = noSelect/);
  assert.match(s, /css\.userSelect = noSelect/);
  // Ao segurar: fecha a linha aberta, cancela o toque e reclama o gesto (não muda de menu).
  const fire = s.slice(s.indexOf('const fireHold'), s.indexOf('const start'));
  for (const k of ['cancelPress()', 'claimSwipe()', 'closeOpenSwipe()', 'holdRef.current?.()']) assert.ok(fire.includes(k), k);
  // Telemóvel: o onLongPress só no telemóvel; com a linha aberta, segurar fecha-a primeiro.
  assert.match(s, /onHold && Platform\.OS !== 'web' \? \{ onLongPress: onHold, delayLongPress: HOLD_MS \}/);
  assert.match(s, /rowHold\(onHold \? \(\) => \{ me\.close\(\); onHold\(\); \}/);
});

test('a lista das conversas e das chamadas não tem ações de deslizar (o deslize fica para mudar de ecrã)', async () => {
  const { readFileSync } = await import('node:fs');
  const inbox = readFileSync(new URL('../src/app/(tabs)/messages.tsx', import.meta.url), 'utf8');
  assert.ok(inbox.includes('<SwipeRow left={[]} right={[]} onHold={hold}'), 'a lista das conversas sem ações de deslizar');
  const calls = readFileSync(new URL('../src/app/calls.tsx', import.meta.url), 'utf8');
  assert.ok(!calls.includes('SwipeRow'), 'as chamadas sem SwipeRow');
  assert.ok(calls.includes('onLongPress={() => setHeld(c)}'), 'segurar uma chamada abre as opções');
});

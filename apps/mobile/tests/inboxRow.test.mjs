// Testes da linha de conversa da lista de Mensagens (src/lib/inboxRow.ts): a hora à direita e o contador de por ler.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const t = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'inboxRow.ts')).href);

// Datas em hora local (os testes passam em qualquer fuso). "Agora" = terça, 10 de novembro de 2026, 15:20.
const now = new Date(2026, 10, 10, 15, 20);
const at = (...a) => new Date(...a).toISOString();

test('listTime: hoje mostra a hora (24 h, com zeros)', () => {
  assert.equal(t.listTime(at(2026, 10, 10, 11, 40), now), '11:40');
  assert.equal(t.listTime(at(2026, 10, 10, 0, 5), now), '00:05');
  assert.equal(t.listTime(at(2026, 10, 10, 15, 19), now), '15:19');
});

test('listTime: ontem é "Ontem", mesmo a um minuto da meia-noite', () => {
  assert.equal(t.listTime(at(2026, 10, 9, 23, 59), now), 'Ontem');
  assert.equal(t.listTime(at(2026, 10, 9, 0, 1), now), 'Ontem');
  assert.equal(t.listTime(at(2026, 10, 10, 0, 1), new Date(2026, 10, 10, 0, 2)), '00:01');
  assert.equal(t.listTime(at(2026, 10, 9, 23, 59), new Date(2026, 10, 10, 0, 1)), 'Ontem');
});

test('listTime: nos últimos 7 dias, o dia da semana', () => {
  assert.equal(t.listTime(at(2026, 10, 8, 20, 0), now), 'Dom'); // 8/11/2026 é domingo
  assert.equal(t.listTime(at(2026, 10, 7, 9, 0), now), 'Sáb');
  assert.equal(t.listTime(at(2026, 10, 4, 9, 0), now), 'Qua'); // há 6 dias
  assert.equal(t.listTime(at(2026, 10, 2, 9, 0), new Date(2026, 10, 4, 9, 0)), 'Seg');
});

test('listTime: mais antigo, dia/mês; noutro ano, também o ano', () => {
  assert.equal(t.listTime(at(2026, 10, 3, 9, 0), now), '03/11'); // há 7 dias: já não é "Ter"
  assert.equal(t.listTime(at(2026, 10, 12, 9, 0), new Date(2026, 11, 1, 9, 0)), '12/11');
  assert.equal(t.listTime(at(2025, 11, 31, 22, 0), new Date(2026, 0, 20, 9, 0)), '31/12/25');
});

test('listTime: futuro (relógio adiantado) conta como hoje; data inválida dá vazio', () => {
  assert.equal(t.listTime(at(2026, 10, 10, 15, 25), now), '15:25');
  assert.equal(t.listTime('lixo', now), '');
});

test('unreadBadge: número até 99, depois "99+"; nada quando lida; ponto quando só foi marcada à mão', () => {
  assert.equal(t.unreadBadge(0), '');
  assert.equal(t.unreadBadge(-1), '');
  assert.equal(t.unreadBadge(1), '1');
  assert.equal(t.unreadBadge(12), '12');
  assert.equal(t.unreadBadge(99), '99');
  assert.equal(t.unreadBadge(100), '99+');
  assert.equal(t.unreadBadge(1, true), 'dot');
  assert.equal(t.unreadBadge(0, true), '');
});

test('rowLabel: o leitor de ecrã diz nome, mensagem, hora e quantas por ler', () => {
  assert.equal(t.rowLabel('Ana', 'Bora?', '11:40', 0), 'Ana, Bora?, 11:40');
  assert.equal(t.rowLabel('Ana', 'Bora?', 'Ontem', 1), 'Ana, Bora?, Ontem, 1 mensagem por ler');
  assert.equal(t.rowLabel('Ana', 'Bora?', 'Seg', 3), 'Ana, Bora?, Seg, 3 mensagens por ler');
  assert.equal(t.rowLabel('Ana', 'Bora?', '', 1, true), 'Ana, Bora?, marcada como por ler');
});

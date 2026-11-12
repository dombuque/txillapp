// Falhas a abrir as mensagens (src/lib/chatErrors.ts). O react-query v5 põe `isError` também quando um refetch falha com
// os dados já lá: a conversa aberta não pode ser trocada por "Não consegui abrir esta conversa" por uns segundos sem
// rede (o refetch de 30 em 30 s, a app a voltar do fundo). E a lista vazia por falta de rede não é "Ainda sem cochichos".
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const e = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'chatErrors.ts')).href);
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

test('a conversa só é tapada pelo erro quando não há nada carregado', () => {
  assert.equal(e.blockingError(true, false), true);
  assert.equal(e.blockingError(true, true), false, 'refetch falhou com a conversa à vista: continua à vista');
  assert.equal(e.blockingError(false, false), false);
});

test('o texto do erro: a conta que não existe não manda verificar a internet', () => {
  assert.match(e.threadErrorText(404), /não existe/);
  assert.match(e.threadErrorText(403), /Não podes/);
  assert.match(e.threadErrorText(0), /internet/);
  assert.match(e.threadErrorText(undefined), /internet/);
});

test('a lista: cada separador olha para a sua fonte; a pesquisa para as duas', () => {
  const ok = { isError: false, hasData: true };
  const down = { isError: true, hasData: false };
  const stale = { isError: true, hasData: true };
  assert.equal(e.inboxFailed('chats', false, down, ok), true);
  assert.equal(e.inboxFailed('requests', false, down, ok), true);
  assert.equal(e.inboxFailed('groups', false, down, ok), false);
  assert.equal(e.inboxFailed('groups', false, ok, down), true);
  assert.equal(e.inboxFailed('chats', true, ok, down), true);
  assert.equal(e.inboxFailed('chats', false, stale, ok), false, 'com dados antigos mostra-os');
});

test('o ecrã da conversa e a lista usam estas regras', () => {
  const thread = read('src/app/messages/[username].tsx');
  assert.match(thread, /if \(blockingError\(q\.isError, !!first\)\)/);
  assert.doesNotMatch(thread, /if \(q\.isError\) \{/);
  assert.match(thread, /Tentar outra vez/);
  const inbox = read('src/app/(tabs)/messages.tsx');
  assert.match(inbox, /const failed = inboxFailed\(/);
  assert.match(inbox, /failed \? \(/);
  assert.match(inbox, /Não consegui carregar as mensagens/);
});

test('lista de Mensagens: a minha publicação partilhada diz "Partilhaste" e os botões da pesquisa têm 44 de altura', () => {
  const inbox = read('src/app/(tabs)/messages.tsx');
  assert.match(inbox, /m\.fromMe \? 'Partilhaste uma publicação' : 'Partilhou uma publicação'/);
  assert.match(inbox, /sBtn: \{ width: 36, height: 44,/);
});

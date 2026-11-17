// Falhas a abrir as mensagens (src/lib/chatErrors.ts). O react-query v5 põe `isError` também quando um refetch falha com
// os dados já lá: a conversa aberta não pode ser trocada por "Não consegui abrir esta conversa" por uns segundos sem
// rede (o refetch de 30 em 30 s, a app a voltar do fundo). E a lista vazia por falta de rede não é "Ainda sem cochichos".
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import './fixtures/alias.mjs'; // o alias @/ (os módulos usam t() de @/lib/i18n)
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
  // Sem rede e com mensagens à espera (lib/chatPending), a conversa abre na mesma e mostra-as (offlineView).
  assert.match(thread, /if \(blockingError\(q\.isError, !!first\) && !offlineView\)/);
  assert.doesNotMatch(thread, /if \(q\.isError\) \{/);
  assert.match(thread, /Tentar outra vez/);
  const inbox = read('src/app/(tabs)/messages.tsx');
  assert.match(inbox, /const failed = inboxFailed\(/);
  assert.match(inbox, /failed \? \(/);
  // O erro comum (components/ui/ErrorState): «Ups, não consegui carregar as mensagens» e «Tentar outra vez».
  assert.match(inbox, /<ErrorState what=\{t\('as mensagens'\)\}/);
});

test('lista de Mensagens: a minha publicação partilhada diz "Partilhaste" e os botões da pesquisa têm 44 de altura', () => {
  const inbox = read('src/app/(tabs)/messages.tsx');
  assert.match(inbox, /m\.fromMe \? t\('Partilhaste uma publicação'\) : t\('Partilhou uma publicação'\)/);
  // A pesquisa é o SearchField (44 de altura) e o SuperTxill um acessório dele: 32 com hitSlop de 6, 44 de toque.
  assert.match(inbox, /<SearchField\r?\n/);
  assert.match(inbox, /right=\{<SearchFieldButton onPress=\{\(\) => router\.push\('\/supertxill' as never\)\} label=\{t\('Abrir o SuperTxill'\)\}>/);
  const field = read('src/components/ui/SearchField.tsx');
  assert.match(field, /<Pressable onPress=\{onPress\} hitSlop=\{6\} style=\{st\.clear\}/);
  assert.match(field, /clear: \{ width: 32, height: 32,/);
});

test('a abrir uma conversa, o cabeçalho já mostra o nome e a foto da lista (não aparece vazio e depois salta)', () => {
  const thread = read('src/app/messages/[username].tsx');
  assert.match(thread, /const listed = useMemo\(\(\) => qc\.getQueryData<Conversation\[\]>\(\['chat-list'\]\)/);
  // Sem rede: o nome guardado com as mensagens à espera (`saved`, lib/chatPending).
  assert.match(thread, /title=\{person\?\.displayName \?\? listed\?\.displayName \?\? saved\?\.name \?\? ''\}/);
  const group = read('src/app/messages/g/[id].tsx');
  assert.match(group, /const listed = useMemo\(\(\) => qc\.getQueryData<TxillGroupSummary\[\]>\(\['chat-groups'\]\)/);
  assert.match(group, /title=\{group\?\.name \?\? listed\?\.name \?\? saved\?\.name \?\? ''\}/);
});

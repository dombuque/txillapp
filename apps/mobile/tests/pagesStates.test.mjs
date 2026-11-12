// Estados de erro e pesquisa em páginas soltas: o convite (/c/[code]), os pedidos e pagamentos (/orders), o evento
// (/evento/[id]) e a Ajuda (/help). Sem rede não se diz "o convite já não está ativo"; os pedidos mostram que estão a
// carregar ou que falharam; um evento apagado não oferece "Tentar outra vez"; a Ajuda procura sem acentos e não abre
// a pergunta errada depois de filtrar.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, 'src', 'app', ...p), 'utf8');

test('convite: sem rede (ou erro do servidor) há "Tentar outra vez"; só um 4xx diz que já não está ativo', () => {
  const src = read('c', '[code].tsx');
  assert.match(src, /const offline = q\.isError && !\(q\.error instanceof ApiError && q\.error\.status < 500\)/);
  assert.match(src, /!p && offline &&/);
  assert.match(src, /!p && !offline &&[\s\S]*Este convite já não está ativo/);
  assert.match(src, /onPress=\{\(\) => void q\.refetch\(\)\}/);
});

test('pedidos: a carregar, falhou (com tentar outra vez), número com nome para o leitor de ecrã e sem dois pedidos', () => {
  const src = read('orders.tsx');
  assert.match(src, /orders\.isLoading \? <ActivityIndicator/);
  assert.match(src, /Não consegui carregar os pedidos/);
  assert.match(src, /accessibilityLabel=\{`O teu número \$\{chosen\.label\}`\}/);
  assert.match(src, /if \(busy \|\| !chosen \|\| !chosenPkg\) return;/);
});

test('evento apagado (404): sem "Tentar outra vez"', () => {
  const src = read('evento', '[id].tsx');
  assert.match(src, /q\.error\.status === 404 \? null : \(/);
});

test('Ajuda: procura sem acentos (normalize das Definições) e a pergunta aberta vai pelo texto', () => {
  const src = read('help.tsx');
  assert.match(src, /import \{ normalize \} from '@\/lib\/settingsIndex'/);
  assert.match(src, /useState<string \| null>\(null\)/);
  assert.match(src, /setOpen\(open === f\.q \? null : f\.q\)/);
  assert.doesNotMatch(src, /list\.map\(\(f, i\)/);
  // O botão do ecrã de entrada chama-se «Esqueceste a senha?»: a Ajuda diz o mesmo.
  assert.match(src, /toca em "Esqueceste a senha\?"/);
});

test('criar evento: no Android as horas abrem o teclado numérico (o de pontuação não existe lá) e sem dois envios', () => {
  const src = read('evento', 'novo.tsx');
  assert.match(src, /const TIME_KEYBOARD = Platform\.OS === 'android' \? 'number-pad' : 'numbers-and-punctuation';/);
  assert.equal((src.match(/keyboardType=\{TIME_KEYBOARD\}/g) ?? []).length, 2);
  assert.doesNotMatch(src, /keyboardType="numbers-and-punctuation"/);
  assert.match(src, /const submit = async \(\) => \{\s*if \(busy\) return;/);
  assert.match(src, /21:30 \(ou 2130\)/);
});

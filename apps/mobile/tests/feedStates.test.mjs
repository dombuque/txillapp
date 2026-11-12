// Testes dos estados das listas de conteúdo (Início, comentários, notificações, tchekas).
// - Início: uma falha ao atualizar ou ao pedir mais (sem rede, no fundo do feed) punha `isError` e a lista inteira dava
//   lugar ao "Ups, a vibe falhou". Agora o que já está carregado fica, e há "Tentar outra vez" no fundo.
// - Sem rede (PWA) o primeiro pedido fica em pausa: `isLoading` é falso e aparecia o estado vazio ("Ainda ninguém
//   brindou por aqui", "Tudo calmo por aqui", "Ainda sem tchekas"). Agora conta `isPending`.
// - Os contadores do cartão (brindes, comentários) têm área de toque folgada.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

test('Início: a lista não se esvazia por um erro com dados carregados, e o fundo deixa tentar outra vez', () => {
  const src = read('app', '(tabs)', 'index.tsx');
  assert.doesNotMatch(src, /data=\{q\.isLoading \|\| q\.isError \? \[\] : posts\}/);
  assert.match(src, /\n\s*data=\{posts\}/);
  assert.match(src, /q\.isFetchNextPageError \? \(/);
  assert.match(src, /onPress=\{\(\) => void q\.fetchNextPage\(\)\}/);
});

test('primeiro carregamento sem rede mostra "a carregar", não o estado vazio', () => {
  assert.match(read('app', '(tabs)', 'index.tsx'), /ListEmptyComponent=\{[\s\S]{0,200}q\.isPending \? \(/);
  assert.match(read('app', 'notifications.tsx'), /ListEmptyComponent=\{\s*q\.isPending \? \(/);
  assert.match(read('components', 'CommentsSheet.tsx'), /q\.isPending \? <ActivityIndicator/);
  assert.match(read('app', '(tabs)', 'reels.tsx'), /const loading = q\.isPending \|\|/);
});

test('cartão: contadores com área de toque folgada', () => {
  const src = read('components', 'PostCard.tsx');
  assert.match(src, /onPress=\{\(\) => open\('comments'\)\} hitSlop=\{12\}/);
  assert.match(src, /onPress=\{\(\) => people\(c\.kind\)\} hitSlop=\{8\}/);
});

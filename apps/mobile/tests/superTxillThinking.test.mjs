// O SuperTxill em conversa: «SuperTxill está a pensar…» enquanto há resposta pendente, com pontos animados, e a
// «Malta para ti» continua lá (separador), também a partir do botão do perfil.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('enquanto a resposta está pendente: «SuperTxill está a pensar…» com animação suave, e a conversa vai perguntando', () => {
  const panel = read('components/SuperTxillPanel.tsx');
  // Só antes do primeiro bocado de texto (depois a bolha cresce: superTxillLive.test.mjs).
  assert.match(panel, /\{chat\.live === 'thinking' && <Thinking \/>\}/);
  assert.match(panel, /SuperTxill está a pensar…<\/Text>/);
  assert.match(panel, /accessibilityLiveRegion="polite" accessibilityLabel="SuperTxill está a pensar…"/);
  assert.match(panel, /Animated\.loop\(Animated\.timing\(a, \{ toValue: 1, duration: 1400, easing: Easing\.inOut\(Easing\.ease\)/);
  // Volta a perguntar ao servidor só enquanto há resposta a caminho.
  assert.match(panel, /refetchInterval: \(query\) => \(query\.state\.data\?\.pending \? 1500 : false\)/);
  // Logo ao enviar já conta como pendente (sem esperar pela volta do servidor).
  assert.match(panel, /const pending = sending \|\| !!q\.data\?\.pending;/);
  // Não se envia outra enquanto pensa.
  assert.match(panel, /disabled=\{!text\.trim\(\) \|\| chat\.pending\}/);
});

test('a conversa e a Malta para ti são separadores; o perfil abre logo a Malta para ti', () => {
  const panel = read('components/SuperTxillPanel.tsx');
  assert.match(panel, /\{ id: 'conversa', label: 'Conversa' \}/);
  assert.match(panel, /\{ id: 'malta', label: 'Malta para ti' \}/);
  assert.match(panel, /accessibilityRole="tab" accessibilityState=\{\{ selected: tab === t\.id \}\}/);
  const route = read('app/supertxill.tsx');
  assert.match(route, /initialTab=\{tab === 'malta' \? 'malta' : 'conversa'\}/);
  assert.match(read('components/ProfileView.tsx'), /router\.push\('\/supertxill\?tab=malta' as never\)/);
});

// Testes do deslize entre separadores da lista de Mensagens: a decisão pequeno/grande e dentro/fora (src/lib/swipeClaim.ts)
// e para que separador vai cada deslize (src/lib/inboxTabs.ts, nextInboxView).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const s = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'swipeClaim.ts')).href);
const t = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'inboxTabs.ts')).href);

const W = 390; // iPhone: limite = max(140, 40% de 390 = 156) = 156
/** Um pager como o das Mensagens, num dado separador (e a pesquisar ou não). */
function inbox(view, searching = false) {
  const p = {
    view,
    went: [],
    canGo: (d) => t.nextInboxView(p.view, d, searching) !== null,
    go: (d) => { p.went.push(d); p.view = t.nextInboxView(p.view, d, searching) ?? p.view; },
  };
  return p;
}

test('navSwipeThreshold: 140 px no mínimo, 40% da largura em ecrãs largos; sem largura (telemóvel sem window) não dá NaN', () => {
  assert.equal(s.navSwipeThreshold(320), 140);
  assert.equal(s.navSwipeThreshold(390), 156);
  assert.equal(s.navSwipeThreshold(800), 320);
  assert.equal(s.navSwipeThreshold(0), 140);
  assert.ok(Number.isFinite(s.navSwipeThreshold()));
});

test('swipeDir: dedo para a esquerda = seguinte (1); para a direita = anterior (-1)', () => {
  assert.equal(s.swipeDir(-200), 1);
  assert.equal(s.swipeDir(200), -1);
});

test('isBigSwipe: pequeno não conta; grande conta; na diagonal (rolar) não conta', () => {
  assert.equal(s.isBigSwipe({ dx: -60, width: W }), false); // deslize pequeno: é da linha (Lida/Apagar)
  assert.equal(s.isBigSwipe({ dx: -155, width: W }), false); // mesmo antes do limite
  assert.equal(s.isBigSwipe({ dx: -156, width: W }), true);
  assert.equal(s.isBigSwipe({ dx: 220, dy: 40, width: W }), true);
  assert.equal(s.isBigSwipe({ dx: 200, dy: 120, width: W }), false); // 200 < 1,8 × 120: é rolar com desvio
  assert.equal(s.isBigSwipe({ dx: 0, width: W }), false);
  assert.equal(s.isBigSwipe({ dx: -150, width: W, threshold: 140 }), true); // o limite pode vir de fora (web)
});

test('isBigSwipe: rápido conta a partir de 30% da largura, mas só para o mesmo lado e com velocidade a sério', () => {
  assert.equal(s.isBigSwipe({ dx: -120, vx: -900, width: W }), true); // 120 ≥ 117 (30%) e rápido
  assert.equal(s.isBigSwipe({ dx: -100, vx: -900, width: W }), false); // rápido mas curto
  assert.equal(s.isBigSwipe({ dx: -120, vx: -300, width: W }), false); // devagar
  assert.equal(s.isBigSwipe({ dx: -120, vx: 900, width: W }), false); // velocidade ao contrário (voltou para trás)
  assert.equal(s.isBigSwipe({ dx: -120, width: W }), false); // sem velocidade (web, linha) só conta a distância
});

test('decideSwipe: pequeno = none; grande com para onde ir = inner; grande na ponta ou sem pager = outer', () => {
  assert.deepEqual(s.decideSwipe({ dx: -60, width: W }, inbox('chats')), { to: 'none', dir: 1 });
  assert.deepEqual(s.decideSwipe({ dx: -200, width: W }, inbox('chats')), { to: 'inner', dir: 1 });
  assert.deepEqual(s.decideSwipe({ dx: 200, width: W }, inbox('chats')), { to: 'outer', dir: -1 }); // 1.º separador, para trás: muda de menu (web)
  assert.deepEqual(s.decideSwipe({ dx: -200, width: W }, inbox('requests')), { to: 'outer', dir: 1 }); // último, para a frente
  assert.deepEqual(s.decideSwipe({ dx: 200, width: W }, inbox('requests')), { to: 'inner', dir: -1 });
  assert.deepEqual(s.decideSwipe({ dx: -200, width: W }, null), { to: 'outer', dir: 1 }); // ecrã sem separadores
});

test('nextInboxView: Conversas ⇄ TxillGroups ⇄ Pedidos, sem dar a volta', () => {
  assert.equal(t.nextInboxView('chats', 1), 'groups');
  assert.equal(t.nextInboxView('groups', 1), 'requests');
  assert.equal(t.nextInboxView('requests', 1), null);
  assert.equal(t.nextInboxView('requests', -1), 'groups');
  assert.equal(t.nextInboxView('groups', -1), 'chats');
  assert.equal(t.nextInboxView('chats', -1), null);
});

test('nextInboxView a pesquisar: só há "Resultados" e "Pedidos"', () => {
  assert.equal(t.nextInboxView('chats', 1, true), 'requests');
  assert.equal(t.nextInboxView('groups', 1, true), 'requests');
  assert.equal(t.nextInboxView('chats', -1, true), null);
  assert.equal(t.nextInboxView('groups', -1, true), null);
  assert.equal(t.nextInboxView('requests', -1, true), 'groups'); // nos pedidos os separadores voltam a aparecer todos
});

test('pager interno: registar, ler e limpar; vários deslizes seguidos andam um separador de cada vez', () => {
  const p = inbox('chats');
  s.registerInnerPager(p);
  assert.equal(s.innerPager(), p);
  for (let i = 0; i < 4; i++) {
    const d = s.decideSwipe({ dx: -220, width: W }, s.innerPager());
    if (d.to === 'inner') s.innerPager().go(d.dir);
  }
  assert.equal(p.view, 'requests');
  assert.deepEqual(p.went, [1, 1]); // a 3.ª e a 4.ª já são "outer" (na web, mudar de menu)
  s.registerInnerPager(null);
  assert.equal(s.innerPager(), null);
});

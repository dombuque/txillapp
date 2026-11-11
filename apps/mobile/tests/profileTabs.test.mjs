// Testes do deslize entre separadores do Perfil (Tudo, Tcheka, Reposts, Presentes, Guardados): quais se veem, para onde vai
// cada deslize e as pontas (src/lib/profileTabs.ts), e a decisão da web ao fim de uns px (src/lib/swipeClaim.ts, pagerLock).
// Também verifica no código que o Perfil usa o mesmo padrão das Mensagens (components/SwipePager e TabSlider).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const t = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'profileTabs.ts')).href);
const s = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'swipeClaim.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

const W = 390; // iPhone: limite de deslize grande = 156 px
const MINE = t.visibleProfileTabs(true);
const OTHER = t.visibleProfileTabs(false);

/** Um pager como o do Perfil, num dado separador. */
function profile(tab, visible = OTHER) {
  const p = {
    tab,
    canGo: (d) => t.nextProfileTab(visible, p.tab, d) !== null,
    go: (d) => { p.tab = t.nextProfileTab(visible, p.tab, d) ?? p.tab; },
  };
  return p;
}

test('visibleProfileTabs: "Guardados" só no meu perfil; a ordem é a do ecrã', () => {
  assert.deepEqual(MINE, ['all', 'reels', 'reposts', 'gifts', 'saved']);
  assert.deepEqual(OTHER, ['all', 'reels', 'reposts', 'gifts']);
});

test('nextProfileTab: dedo para a esquerda = seguinte, para a direita = anterior', () => {
  assert.equal(t.nextProfileTab(OTHER, 'all', 1), 'reels');
  assert.equal(t.nextProfileTab(OTHER, 'reels', 1), 'reposts');
  assert.equal(t.nextProfileTab(OTHER, 'reposts', -1), 'reels');
  assert.equal(t.nextProfileTab(MINE, 'gifts', 1), 'saved');
  assert.equal(t.nextProfileTab(MINE, 'saved', -1), 'gifts');
});

test('nextProfileTab: nas pontas devolve null (no primeiro para trás fica para o voltar; no último não faz nada)', () => {
  assert.equal(t.nextProfileTab(OTHER, 'all', -1), null);
  assert.equal(t.nextProfileTab(MINE, 'all', -1), null);
  assert.equal(t.nextProfileTab(OTHER, 'gifts', 1), null); // perfil dos outros: Presentes é o último
  assert.equal(t.nextProfileTab(MINE, 'saved', 1), null);
});

test('nextProfileTab: salta os separadores que esta pessoa não tem', () => {
  // Se um separador do meio não existir (ex.: Presentes escondido), o deslize passa por cima dele.
  const noGifts = ['all', 'reels', 'reposts', 'saved'];
  assert.equal(t.nextProfileTab(noGifts, 'reposts', 1), 'saved');
  assert.equal(t.nextProfileTab(noGifts, 'saved', -1), 'reposts');
  const onlyTwo = ['all', 'gifts'];
  assert.equal(t.nextProfileTab(onlyTwo, 'all', 1), 'gifts');
  assert.equal(t.nextProfileTab(onlyTwo, 'gifts', -1), 'all');
  assert.equal(t.nextProfileTab(onlyTwo, 'gifts', 1), null);
  // "Guardados" num perfil que não é o meu nunca aparece.
  assert.equal(t.nextProfileTab(OTHER, 'gifts', 1), null);
  // Separador atual que já não se vê (ex.: a sessão mudou): anda a partir da posição dele e cai num visível.
  assert.equal(t.nextProfileTab(OTHER, 'saved', -1), 'gifts');
  assert.equal(t.nextProfileTab(OTHER, 'saved', 1), null);
  assert.equal(t.nextProfileTab(OTHER, 'nada', 1), null);
});

test('profileTabEdges: para que lados se pode ir (o pan do telemóvel só ativa para esses)', () => {
  assert.deepEqual(t.profileTabEdges(OTHER, 'all'), { prev: false, next: true });
  assert.deepEqual(t.profileTabEdges(OTHER, 'reels'), { prev: true, next: true });
  assert.deepEqual(t.profileTabEdges(OTHER, 'gifts'), { prev: true, next: false });
  assert.deepEqual(t.profileTabEdges(['all'], 'all'), { prev: false, next: false });
});

test('decideSwipe com o pager do Perfil: grande muda de separador; pequeno não; na ponta passa para fora', () => {
  const p = profile('all');
  assert.equal(s.decideSwipe({ dx: -60, width: W }, p).to, 'none');
  assert.deepEqual(s.decideSwipe({ dx: -200, dy: 10, width: W }, p), { to: 'inner', dir: 1 });
  p.go(1);
  assert.equal(p.tab, 'reels');
  // No primeiro, para a direita: fora (voltar atrás / mudar de menu), sem mexer no separador.
  assert.deepEqual(s.decideSwipe({ dx: 200, width: W }, profile('all')), { to: 'outer', dir: -1 });
  // No último, para a esquerda: fora (e o Perfil não faz nada).
  assert.deepEqual(s.decideSwipe({ dx: -200, width: W }, profile('gifts')), { to: 'outer', dir: 1 });
  // Rápido e já com 30% da largura também conta.
  assert.equal(s.decideSwipe({ dx: -130, vx: -900, width: W }, profile('reels')).to, 'inner');
  // A rolar na diagonal não muda.
  assert.equal(s.decideSwipe({ dx: -200, dy: 150, width: W }, profile('reels')).to, 'none');
});

test('pagerLock (web): espera uns px, rolar fica com o browser, e só é nosso para um lado com separador', () => {
  const mid = profile('reels');
  assert.equal(s.pagerLock(4, 3, true, mid), 'wait');
  assert.equal(s.pagerLock(-14, 2, true, mid), 'side');
  assert.equal(s.pagerLock(14, 2, true, mid), 'side');
  assert.equal(s.pagerLock(4, 20, true, mid), 'off'); // rolar
  assert.equal(s.pagerLock(-12, 10, true, mid), 'off'); // diagonal: rolar
  assert.equal(s.pagerLock(-20, 0, false, mid), 'off'); // o browser já está a rolar
  // No primeiro, para a direita: não é nosso (fica para o voltar atrás ou para lib/swipeTabs).
  assert.equal(s.pagerLock(20, 0, true, profile('all')), 'off');
  assert.equal(s.pagerLock(-20, 0, true, profile('all')), 'side');
  // No último, para a esquerda: não é nosso.
  assert.equal(s.pagerLock(-20, 0, true, profile('gifts')), 'off');
  // Sem pager: nunca.
  assert.equal(s.pagerLock(-20, 0, true, null), 'off');
});

test('Perfil: usa o padrão das Mensagens (SwipePager, TabSlider) e o toque continua a mudar de separador', () => {
  const src = read('components', 'ProfileView.tsx');
  assert.match(src, /usePagerPan\(/);
  assert.match(src, /useWebPager\(/);
  assert.match(src, /useTabSlider<ProfileTab>/);
  assert.match(src, /useFadeIn\(\)/);
  assert.match(src, /visibleProfileTabs\(/);
  assert.match(src, /onPress=\{\(\) => switchTab\(t\.id\)\}/);
  assert.match(src, /onPress=\{\(\) => onOpen\(post\)\}/); // tocar numa miniatura abre a publicação
  assert.match(src, /accessibilityRole="tablist"/);
  assert.match(src, /accessibilityRole="tab"/);
  // As Mensagens continuam com o mesmo pan (agora partilhado).
  const msg = read('app', '(tabs)', 'messages.tsx');
  assert.match(msg, /usePagerPan\(\{ width, pager: innerPager, skip: \(\) => notesTouch\.current \}\)/);
  assert.match(msg, /registerInnerPager\(p\)/);
});

test('SwipePager (web): toques no próprio elemento (não no document), reclama o gesto só quando muda e liberta-o depois', () => {
  const src = read('components', 'SwipePager.tsx');
  assert.doesNotMatch(src, /document\.addEventListener/);
  for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'click']) {
    assert.match(src, new RegExp(`el\\.addEventListener\\('${ev}'`));
    assert.match(src, new RegExp(`el\\.removeEventListener\\('${ev}'`));
  }
  const claims = src.match(/claimSwipe\(\)/g) ?? [];
  assert.equal(claims.length, 1);
  assert.match(src, /releaseSwipeSoon\(\)/);
});

test('swipeClaim: quem reclama um gesto na web liberta-o no fim (um claimSwipe preso bloqueava a mudança de menu)', () => {
  for (const f of [['components', 'SwipePager.tsx'], ['components', 'ReplySwipe.tsx']]) {
    const src = read(...f);
    if (/claimSwipe\(\)/.test(src)) assert.match(src, /releaseSwipe(Soon)?\(\)/, f.join('/'));
  }
});

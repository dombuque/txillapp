// O «voltar» do browser fecha folhas e visores (src/lib/webBack.ts), sem baralhar o histórico do expo-router.
// Simula-se um browser (entradas, popstate assíncrono, stopImmediatePropagation) e um "expo-router" que ouve o popstate
// depois de nós e escreve entradas { id } com pushState / replaceState / go, como o browserHistoryAdapter dele.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wb = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'webBack.ts')).href);

const ORIGIN = 'https://txillapp.com';
const tick = () => new Promise((r) => setTimeout(r, 5));

/** Browser de mentira: entradas { state, href }, um índice e popstate entregue de forma assíncrona (como no Safari). */
function fakeBrowser(startPath = '/') {
  const entries = [{ state: { id: 'e0' }, href: ORIGIN + startPath }];
  let index = 0;
  const listeners = [];
  const history = {
    get state() { return entries[index].state; },
    pushState(data, _u, url) {
      entries.splice(index + 1);
      entries.push({ state: structuredClone(data), href: url == null ? entries[index].href : new URL(String(url), entries[index].href).href });
      index++;
    },
    replaceState(data, _u, url) {
      entries[index] = { state: structuredClone(data), href: url == null ? entries[index].href : new URL(String(url), entries[index].href).href };
    },
    go(n = 0) {
      const to = index + n;
      if (n === 0 || to < 0 || to >= entries.length) return;
      setTimeout(() => {
        index = to;
        let stopped = false;
        const ev = { stopImmediatePropagation() { stopped = true; } };
        for (const l of [...listeners]) { if (stopped) break; l(ev); }
      }, 1);
    },
    back() { this.go(-1); },
    forward() { this.go(1); },
  };
  const win = {
    history,
    location: {
      get href() { return entries[index].href; },
      get pathname() { return new URL(entries[index].href).pathname; },
      get search() { return new URL(entries[index].href).search; },
      get hash() { return new URL(entries[index].href).hash; },
    },
    addEventListener: (_t, fn) => listeners.push(fn),
    removeEventListener: (_t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t),
  };
  // O botão / gesto do browser não passa pelo window.history (que o webBack embrulha): usa o go original.
  const nativeGo = history.go.bind(history);
  return { win, entries, get index() { return index; }, user: { back: () => nativeGo(-1), forward: () => nativeGo(1) } };
}

/**
 * "Expo-router" mínimo: uma pilha de ecrãs (path + id). Ouve o popstate depois de nós e escreve no histórico só através de
 * window.history (que o webBack embrulha), como o verdadeiro.
 */
function fakeRouter(b) {
  let n = 0;
  const screens = [{ id: 'e0', path: new URL(b.win.location.href).pathname }];
  const seen = [];
  b.win.addEventListener('popstate', () => {
    const id = b.win.history.state?.id;
    seen.push(id);
    const i = screens.findIndex((s) => s.id === id);
    if (i >= 0) screens.splice(i + 1);
  });
  const h = () => b.win.history; // lido a cada chamada, como o adaptador do expo-router
  return {
    seen,
    screens,
    top: () => screens[screens.length - 1].path,
    push(p) { const id = `r${++n}`; screens.push({ id, path: p }); h().pushState({ id }, '', p); },
    replace(p) { const top = screens[screens.length - 1]; top.path = p; h().replaceState({ id: top.id }, '', p); },
    back() { screens.pop(); h().go(-1); },
  };
}

const path_ = (b) => new URL(b.win.location.href).pathname;

test('«voltar» com uma folha aberta fecha a folha e fica no mesmo ecrã (o router não dá por nada)', async () => {
  const b = fakeBrowser('/u/ana');
  const back = wb.createWebBack(b.win);
  const r = fakeRouter(b);
  let closed = 0;
  back.open(() => closed++);
  assert.equal(b.entries.length, 2);
  b.user.back();
  await tick();
  assert.equal(closed, 1);
  assert.equal(b.index, 0);
  assert.equal(path_(b), '/u/ana');
  assert.deepEqual(r.seen, [], 'o popstate da folha não chega ao router');
  assert.equal(back.depth(), 0);
});

test('fechar a folha no × tira a entrada dela (o «voltar» seguinte sai do ecrã, não fica preso)', async () => {
  const b = fakeBrowser('/');
  const back = wb.createWebBack(b.win);
  const r = fakeRouter(b);
  r.push('/p/1');
  let closed = 0;
  const close = back.open(() => closed++);
  close();
  close(); // duas vezes não faz mal
  await tick();
  assert.equal(b.index, 1);
  assert.equal(path_(b), '/p/1');
  assert.equal(closed, 0, 'fechar à mão não chama o onBack');
  assert.deepEqual(r.seen, []);
  b.user.back();
  await tick();
  assert.equal(path_(b), '/');
  assert.deepEqual(r.seen, ['e0'], 'o «voltar» seguinte vai ao router');
});

test('fechar a folha e navegar logo a seguir: a navegação nova não é desfeita pelo recuo da folha', async () => {
  const b = fakeBrowser('/');
  const back = wb.createWebBack(b.win);
  const r = fakeRouter(b);
  const close = back.open(() => {});
  close();
  r.push('/u/rui'); // no mesmo instante
  await tick();
  await tick();
  assert.equal(path_(b), '/u/rui');
  assert.equal(b.entries.length, 2, 'só o ecrã de baixo e o novo; a entrada da folha foi-se');
  assert.equal(b.entries[1].state.id, 'r1');
  assert.equal(b.entries[1].state[wb.MARK], undefined);
  b.user.back();
  await tick();
  assert.equal(path_(b), '/');
  assert.equal(r.top(), '/');
});

test('navegar com a folha ainda aberta (o pushState chega antes de a folha fechar): tira-se a entrada primeiro', async () => {
  const b = fakeBrowser('/');
  const back = wb.createWebBack(b.win);
  const r = fakeRouter(b);
  let closed = 0;
  const close = back.open(() => closed++);
  r.push('/messages/ana');
  close(); // a folha desmonta depois
  await tick();
  await tick();
  assert.equal(path_(b), '/messages/ana');
  assert.equal(b.entries.length, 2);
  assert.equal(closed, 0);
  b.user.back();
  await tick();
  assert.equal(path_(b), '/');
  assert.deepEqual(r.seen, ['e0']);
});

test('router.replace com a folha aberta: substitui a entrada do ecrã, não a da folha', async () => {
  const b = fakeBrowser('/');
  const back = wb.createWebBack(b.win);
  const r = fakeRouter(b);
  r.push('/p/1');
  back.open(() => {});
  r.replace('/p/2');
  await tick();
  await tick();
  assert.equal(b.index, 1, 'a substituição caiu na entrada do ecrã (a da folha fica só para «avançar»)');
  assert.equal(path_(b), '/p/2');
  assert.equal(b.entries[1].state.id, 'r1');
  assert.equal(b.entries[1].state[wb.MARK], undefined);
});

test('o router a reescrever a mesma entrada (mesmo id e endereço) não tira o «voltar» da folha', async () => {
  const b = fakeBrowser('/');
  const back = wb.createWebBack(b.win);
  fakeRouter(b);
  let closed = 0;
  back.open(() => closed++);
  b.win.history.replaceState({ id: 'e0' }, '', '/');
  assert.equal(b.entries.length, 2);
  assert.equal(b.entries[1].state[wb.MARK] != null, true);
  b.user.back();
  await tick();
  assert.equal(closed, 1);
});

test('router.back() com a folha aberta salta a entrada da folha e volta mesmo ao ecrã anterior', async () => {
  const b = fakeBrowser('/');
  const back = wb.createWebBack(b.win);
  const r = fakeRouter(b);
  r.push('/p/1');
  let closed = 0;
  const close = back.open(() => closed++);
  r.back();
  close();
  await tick();
  await tick();
  assert.equal(path_(b), '/');
  assert.equal(b.index, 0);
  assert.equal(closed, 0);
});

test('folha por cima de folha: cada «voltar» fecha a de cima', async () => {
  const b = fakeBrowser('/');
  const back = wb.createWebBack(b.win);
  const r = fakeRouter(b);
  const log = [];
  back.open(() => log.push('menu'));
  back.open(() => log.push('confirmar'));
  assert.equal(back.depth(), 2);
  b.user.back();
  await tick();
  assert.deepEqual(log, ['confirmar']);
  b.user.back();
  await tick();
  assert.deepEqual(log, ['confirmar', 'menu']);
  assert.equal(b.index, 0);
  assert.deepEqual(r.seen, []);
});

test('fechar uma folha e abrir outra logo a seguir (menu → confirmar): o «voltar» fecha a segunda', async () => {
  const b = fakeBrowser('/');
  const back = wb.createWebBack(b.win);
  fakeRouter(b);
  const log = [];
  const c1 = back.open(() => log.push('menu'));
  c1();
  back.open(() => log.push('confirmar'));
  await tick();
  await tick();
  assert.equal(b.entries.length, 2);
  assert.equal(b.index, 1);
  b.user.back();
  await tick();
  assert.deepEqual(log, ['confirmar']);
  assert.equal(b.index, 0);
});

test('«avançar» para a entrada de uma folha já fechada volta à entrada verdadeira', async () => {
  const b = fakeBrowser('/');
  const back = wb.createWebBack(b.win);
  fakeRouter(b);
  back.open(() => {});
  b.user.back();
  await tick();
  assert.equal(b.index, 0);
  b.user.forward();
  await tick();
  await tick();
  assert.equal(b.index, 0, 'a entrada morta não fica como ecrã');
});

import { readFileSync } from 'node:fs';
const src = (p) => readFileSync(path.join(ROOT, 'src', p), 'utf8');

test('as folhas e os visores usam o Modal com «voltar» da web; o histórico liga-se no arranque, antes do expo-router', () => {
  const layout = src('app/_layout.tsx');
  assert.match(layout, /import \{ installWebBack \} from '@\/lib\/webBack'/);
  assert.match(layout, /^installWebBack\(\);$/m, 'chamado ao carregar o módulo, não num efeito');
  const modal = src('components/Modal.tsx');
  assert.match(modal, /useWebBack\(props\.visible !== false, onWebBack \?\? close\)/);
  for (const f of ['Sheet', 'ChatAttachSheet', 'ChatBubbles', 'ExploreViewer', 'Instants', 'PhotoTagger', 'PhotoViewer', 'ProfileStoryAvatar', 'SendLocationSheet', 'ShareSheet', 'CarouselVideo', 'AlertHost', 'WelcomeTour']) {
    const s = src(`components/${f}.tsx`);
    assert.match(s, /import \{ Modal(, iosWeb)? \} from '@\/components\/Modal'/, f);
    assert.doesNotMatch(s, /import \{[^}]*\bModal\b[^}]*\} from 'react-native'/, f);
  }
  // No iPhone o arrastar para trás já mostrou o ecrã de baixo: a folha fecha sem animar outra vez.
  assert.match(src('components/Sheet.tsx'), /onWebBack=\{iosWeb \? onClose : close\}/);
});

// Com o adaptador VERDADEIRO do expo-router (node_modules/expo-router/build/global-state/browserHistoryAdapter.js) por cima
// do nosso: é ele que escreve no histórico na app. Se o expo-router mudar a maneira de o fazer, estes testes avisam.
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
function realAdapter(b) {
  globalThis.window = b.win;
  const id = require_.resolve('expo-router/build/global-state/browserHistoryAdapter.js', { paths: [ROOT] });
  delete require_.cache[id];
  const { createBrowserHistoryAdapter } = require_(id);
  const a = createBrowserHistoryAdapter();
  const changes = [];
  a.listen((c) => changes.push(c));
  return { a, changes };
}

test('expo-router a sério: «voltar» numa folha não lhe chega; fechar e navegar deixa-o no ecrã novo', async () => {
  const b = fakeBrowser('/');
  const back = wb.createWebBack(b.win);
  const { a, changes } = realAdapter(b);
  let closed = 0;
  back.open(() => closed++);
  b.user.back();
  await tick();
  assert.equal(closed, 1);
  assert.deepEqual(changes, []);
  const close = back.open(() => closed++);
  close();
  a.apply({ op: 'push', entryId: 'r1', path: '/u/rui' });
  await tick();
  await tick();
  assert.equal(path_(b), '/u/rui');
  assert.equal(b.win.history.state.id, 'r1');
  assert.deepEqual(changes, []);
  b.user.back();
  await tick();
  assert.deepEqual(changes, [{ id: 'e0', path: '/' }], 'o «voltar» do ecrã chega-lhe normalmente');
});

test('expo-router a sério: router.back() com uma folha aberta volta ao ecrã anterior e o go dele termina', async () => {
  const b = fakeBrowser('/');
  const back = wb.createWebBack(b.win);
  const { a, changes } = realAdapter(b);
  a.apply({ op: 'push', entryId: 'r1', path: '/p/1' });
  await tick();
  back.open(() => {});
  a.apply({ op: 'go', delta: -1 });
  await tick();
  await tick();
  assert.equal(path_(b), '/');
  assert.equal(b.win.history.state.id, 'e0');
  assert.deepEqual(changes, [], 'o go é dele: não o trata como «voltar» do browser');
  // A fila dele não ficou presa: a navegação seguinte acontece.
  a.apply({ op: 'push', entryId: 'r2', path: '/search' });
  await tick();
  assert.equal(path_(b), '/search');
  delete globalThis.window;
});

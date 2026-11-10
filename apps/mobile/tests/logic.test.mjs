// Testes da lógica pura da app (sem dispositivo nem dependências novas).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
// Funções que vivem dentro de ficheiros de componentes (TxCamera, AppUpdate, new.tsx) são lidas do código-fonte tal como
// estão (extraídas pelo nome), para se testar o código real sem as mudar de sítio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const url = (rel) => pathToFileURL(path.join(SRC, rel)).href;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'txill-logic-'));

/** O texto de `function nome(...) {...}` (com `export`/`async` à frente, se houver) num ficheiro de src/. */
function extract(rel, name) {
  const s = fs.readFileSync(path.join(SRC, rel), 'utf8');
  const m = new RegExp(`(?:export )?(?:async )?function ${name}\\(`).exec(s);
  assert.ok(m, `${name} não encontrado em ${rel}`);
  let i = s.indexOf(')', m.index);
  i = s.indexOf('{', i);
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return s.slice(m.index, j + 1).replace(/^export /, '');
  }
  throw new Error(`fim de ${name} não encontrado`);
}
/** Módulo TS temporário com `prelude` + a função extraída, exportada. */
async function load(name, prelude, body) {
  const f = path.join(TMP, `${name}.ts`);
  fs.writeFileSync(f, `${prelude}\nexport ${body}\n`);
  return import(pathToFileURL(f).href);
}

// Módulos de fora (react, react-native, expo-router) trocados por versões mínimas, e o "@/" resolvido para src/.
const stubs = {
  react: 'export const useEffect = (fn) => { globalThis.__effectCleanup = fn(); };',
  'react-native': 'export const Platform = { OS: "web" };',
  'expo-router': 'export const usePathname = () => globalThis.__pathname; export const useRouter = () => globalThis.__router;',
};
registerHooks({
  resolve(spec, ctx, next) {
    if (stubs[spec]) return { url: `data:text/javascript,${encodeURIComponent(stubs[spec])}`, shortCircuit: true };
    if (spec.startsWith('@/')) return { url: url(`${spec.slice(2)}.ts`), shortCircuit: true };
    return next(spec, ctx);
  },
});

const { clampPostRatio, POST_RATIO_MIN, POST_RATIO_MAX, POST_RATIO_DEFAULT } = await import(url('lib/postAspect.ts'));
const claim = await import(url('lib/swipeClaim.ts'));

test('clampPostRatio: sem medidas é 1:1; fora do intervalo fica em 4:5 ou 1,91:1', () => {
  assert.equal(clampPostRatio(), 1);
  assert.equal(clampPostRatio(null, 100), 1);
  assert.equal(clampPostRatio(100, 0), 1);
  assert.equal(clampPostRatio(1080, 1080), 1);
  assert.equal(clampPostRatio(1080, 1350), 0.8); // 4:5
  assert.equal(clampPostRatio(1080, 1920), 0.8); // 9:16 (vídeo/captura de ecrã) -> 4:5
  assert.equal(clampPostRatio(3, 4), 0.8); // 3:4 da câmara -> 4:5
  assert.ok(Math.abs(clampPostRatio(1920, 1080) - 16 / 9) < 1e-12); // 16:9 cabe
  assert.equal(clampPostRatio(4000, 1000), 1.91); // panorama -> 1,91:1
  assert.equal(POST_RATIO_MIN, 0.8);
  assert.equal(POST_RATIO_MAX, 1.91);
  assert.equal(POST_RATIO_DEFAULT, 0.8);
});

test('feed (PostCard): altura da caixa = min(largura / proporção da 1.ª, max(320, 80% da janela))', () => {
  // A expressão está dentro do componente Carousel; confirma-se que é esta e calcula-se com os mesmos valores.
  const src = fs.readFileSync(path.join(SRC, 'components/PostCard.tsx'), 'utf8');
  assert.ok(src.includes('const h = Math.round(Math.min(width / clampPostRatio(first.width, first.height), Math.max(320, winH * 0.8)));'));
  const h = (width, m, winH) => Math.round(Math.min(width / clampPostRatio(m.width, m.height), Math.max(320, winH * 0.8)));
  assert.equal(h(390, {}, 844), 390); // sem medidas: quadrado
  assert.equal(h(390, { width: 1080, height: 1920 }, 844), 488); // vídeo 9:16 numa caixa 4:5
  assert.equal(h(390, { width: 1080, height: 1350 }, 844), 488);
  assert.equal(h(390, { width: 1910, height: 1000 }, 844), 204); // 1,91:1
  assert.equal(h(576, { width: 1080, height: 1350 }, 700), 560); // computador, janela baixa: teto 560
  assert.equal(h(800, { width: 1080, height: 1350 }, 380), 320); // telemóvel deitado: teto mínimo 320
});

const { fitPostBox } = await load('fitPostBox', `import { POST_RATIO_MAX, POST_RATIO_MIN } from '${url('lib/postAspect.ts')}';\ntype Box = { x: number; y: number; w: number; h: number };`, extract('components/TxCamera.tsx', 'fitPostBox'));

test('fitPostBox: caixa dentro da foto, dentro da original e entre 4:5 e 1,91:1, com o lado certo preso', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const EPS = 1e-9;
  const kinds = ['nw', 'ne', 'sw', 'se', 'move'];
  for (let n = 0; n < 20000; n++) {
    const w = 0.12 + rnd() * 0.88, h = 0.12 + rnd() * 0.88;
    const b = { x: rnd() * (1 - w), y: rnd() * (1 - h), w, h };
    const ir = 0.3 + rnd() * 3; // proporção da foto (já rodada)
    const kind = kinds[n % 5];
    const o = fitPostBox(b, ir, kind);
    const r = (o.w / o.h) * ir;
    const msg = JSON.stringify({ b, ir, kind, o, r });
    assert.ok(r >= POST_RATIO_MIN - 1e-9 && r <= POST_RATIO_MAX + 1e-9, `proporção fora: ${msg}`);
    assert.ok(o.x >= b.x - EPS && o.y >= b.y - EPS && o.x + o.w <= b.x + b.w + EPS && o.y + o.h <= b.y + b.h + EPS, `saiu da caixa: ${msg}`);
    assert.ok(o.x >= -EPS && o.y >= -EPS && o.x + o.w <= 1 + EPS && o.y + o.h <= 1 + EPS, `saiu da foto: ${msg}`);
    const r0 = (b.w / b.h) * ir;
    if (r0 >= POST_RATIO_MIN && r0 <= POST_RATIO_MAX) assert.deepEqual(o, b, `mexeu numa caixa válida: ${msg}`);
    if (r0 > POST_RATIO_MAX) {
      assert.equal(o.y, b.y); assert.equal(o.h, b.h);
      if (kind === 'ne' || kind === 'se') assert.equal(o.x, b.x); // arrasta a direita: a esquerda fica
      if (kind === 'nw' || kind === 'sw') assert.ok(Math.abs(o.x + o.w - (b.x + b.w)) < EPS); // arrasta a esquerda: a direita fica
      if (kind === 'move') assert.ok(Math.abs(o.x + o.w / 2 - (b.x + b.w / 2)) < EPS); // ao centro
    }
    if (r0 < POST_RATIO_MIN) {
      assert.equal(o.x, b.x); assert.equal(o.w, b.w);
      if (kind === 'sw' || kind === 'se') assert.equal(o.y, b.y);
      if (kind === 'nw' || kind === 'ne') assert.ok(Math.abs(o.y + o.h - (b.y + b.h)) < EPS);
      if (kind === 'move') assert.ok(Math.abs(o.y + o.h / 2 - (b.y + b.h / 2)) < EPS);
    }
  }
});

test('fitPostBox: rodar 90° uma caixa 4:5 de foto vertical volta a caber no intervalo', () => {
  // Foto 3:4 (ir 0,75), caixa inteira = 0,75 -> encolhe a altura para 4:5.
  const a = fitPostBox({ x: 0, y: 0, w: 1, h: 1 }, 0.75, 'move');
  assert.ok(Math.abs((a.w / a.h) * 0.75 - 0.8) < 1e-12);
  // Rodada (ir 4/3): a mesma caixa normalizada passa a 1,333 (cabe) — fica igual.
  assert.deepEqual(fitPostBox(a, 4 / 3, 'move'), a);
  // Panorama rodado para vertical (ir 1/3): caixa inteira = 0,333 -> encolhe a altura, centrada.
  const p = fitPostBox({ x: 0, y: 0, w: 1, h: 1 }, 1 / 3, 'move');
  assert.ok(Math.abs((p.w / p.h) / 3 - 0.8) < 1e-12 && Math.abs(p.y + p.h / 2 - 0.5) < 1e-12);
});

test('swipeClaim: reclamar, devolver, repor e limiar max(140, 40% da largura)', () => {
  claim.resetSwipeClaim();
  assert.equal(claim.isSwipeClaimed(), false);
  claim.claimSwipe();
  assert.equal(claim.isSwipeClaimed(), true);
  claim.releaseSwipe();
  assert.equal(claim.isSwipeClaimed(), false);
  claim.claimSwipe();
  claim.resetSwipeClaim();
  assert.equal(claim.isSwipeClaimed(), false);
  const at = (w) => { globalThis.window = { innerWidth: w }; return claim.navSwipeThreshold(); };
  assert.equal(at(320), 140);
  assert.equal(at(350), 140);
  assert.equal(at(390), 156);
  assert.equal(at(430), 172);
  assert.equal(at(768), 307);
});

// lib/swipeTabs com um document falso: só os toques que interessam (touchstart em captura, touchend).
function fakeDom(width) {
  const ls = {};
  const plain = { matches: () => false, parentElement: null, scrollWidth: 0, clientWidth: 0 };
  globalThis.window = { innerWidth: width };
  globalThis.getComputedStyle = () => ({ overflowX: 'visible' });
  globalThis.document = {
    body: {},
    addEventListener: (t, fn) => { (ls[t] ??= []).push(fn); },
    removeEventListener: (t, fn) => { ls[t] = (ls[t] ?? []).filter((f) => f !== fn); },
  };
  const fire = (t, e) => (ls[t] ?? []).forEach((fn) => fn(e));
  return {
    count: (t) => (ls[t] ?? []).length,
    swipe({ x = 200, y = 400, dx, dy = 0, target = plain, during }) {
      fire('touchstart', { touches: [{ clientX: x, clientY: y }], target });
      during?.();
      fire('touchend', { changedTouches: [{ clientX: x + dx, clientY: y + dy }] });
    },
  };
}
const { useSwipeTabs } = await import(url('lib/swipeTabs.ts'));
function mount(pathname, width = 390) {
  const dom = fakeDom(width);
  const went = [];
  globalThis.__pathname = pathname;
  globalThis.__router = { navigate: (p) => went.push(p) };
  useSwipeTabs();
  return { dom, went, unmount: () => globalThis.__effectCleanup?.() };
}

test('swipeTabs: deslize grande muda de separador, sem dar a volta; no Início para a direita abre a câmara', () => {
  let m = mount('/');
  m.dom.swipe({ dx: -200 }); m.dom.swipe({ dx: 200 });
  assert.deepEqual(m.went, ['/reels', '/new']); m.unmount();
  m = mount('/messages');
  m.dom.swipe({ dx: -200 }); m.dom.swipe({ dx: 200 });
  assert.deepEqual(m.went, ['/profile', '/reels']); m.unmount();
  m = mount('/profile');
  m.dom.swipe({ dx: -200 });
  assert.deepEqual(m.went, []); m.unmount();
  m = mount('/reels');
  m.dom.swipe({ dx: 200 });
  assert.deepEqual(m.went, ['/']); m.unmount();
});

test('swipeTabs: não muda de menu com deslize curto, diagonal, reclamado, na margem, em campos ou no computador', () => {
  let m = mount('/messages');
  m.dom.swipe({ dx: -150 }); // < 156 (40% de 390)
  m.dom.swipe({ dx: -200, dy: 120 }); // |dx| < 1,8 |dy|
  m.dom.swipe({ dx: -200, during: () => claim.claimSwipe() }); // linha/pilha reclamou o gesto
  m.dom.swipe({ x: 10, dx: 250 }); // margem do gesto de voltar do iPhone
  m.dom.swipe({ x: 380, dx: -250 });
  const input = { matches: (q) => q.includes('input'), parentElement: null };
  m.dom.swipe({ dx: -200, target: input });
  assert.deepEqual(m.went, []);
  // O touchstart repõe a reclamação do gesto anterior.
  claim.claimSwipe();
  m.dom.swipe({ dx: -200 });
  assert.deepEqual(m.went, ['/profile']);
  // Lento demais (> 900 ms).
  const now = Date.now;
  let t = 1_000_000;
  Date.now = () => t;
  try { m.dom.swipe({ dx: -200, during: () => { t += 1000; } }); } finally { Date.now = now; }
  assert.deepEqual(m.went, ['/profile']);
  m.unmount();
  assert.equal(m.dom.count('touchstart') + m.dom.count('touchend') + m.dom.count('touchcancel'), 0, 'ouvintes removidos');
  m = mount('/messages', 1100);
  m.dom.swipe({ dx: -600 });
  assert.deepEqual(m.went, []); m.unmount();
  m = mount('/reels/filtros');
  assert.equal(m.dom.count('touchstart'), 0, 'fora dos separadores não escuta');
});

const { compareVersions } = await load('compareVersions', '', extract('components/AppUpdate.tsx', 'compareVersions'));
test('compareVersions', () => {
  assert.ok(compareVersions('1.14.2', '1.14.1') > 0);
  assert.ok(compareVersions('1.14.1', '1.14.2') < 0);
  assert.ok(compareVersions('1.14.10', '1.14.9') > 0);
  assert.ok(compareVersions('2.0.0', '1.99.99') > 0);
  assert.equal(compareVersions('1.14', '1.14.0'), 0);
  assert.equal(compareVersions('1.14.2', '1.14.2'), 0);
});

// fitCarousel (new.tsx) com imageRatio/cropToRatio falsos: decide a proporção do carrossel.
const ratios = new Map();
const crops = [];
globalThis.__ratios = ratios; globalThis.__crops = crops;
const { fitCarousel } = await load('fitCarousel', [
  `import { clampPostRatio } from '${url('lib/postAspect.ts')}';`,
  'const Platform = { OS: "android" };',
  'interface Asset { uri: string; video: boolean; mime: string; durationMs?: number; tags: unknown[]; ratio?: number }',
  'const R = (globalThis as any).__ratios as Map<string, number | null>;',
  'const C = (globalThis as any).__crops as { uri: string; ratio: number }[];',
  'async function imageRatio(uri: string) { return R.has(uri) ? R.get(uri)! : null; }',
  'async function cropToRatio(uri: string, ratio: number) { C.push({ uri, ratio }); return uri.startsWith("fail") ? uri : `${uri}#${ratio.toFixed(3)}`; }',
].join('\n'), extract('app/(tabs)/new.tsx', 'fitCarousel'));
const photo = (uri, r) => { ratios.set(uri, r); return { uri, video: false, mime: 'image/png', tags: [] }; };
const vid = (uri) => ({ uri, video: true, mime: 'video/mp4', tags: [] });

test('fitCarousel: proporção da 1.ª foto (limitada), vídeos intactos, a que falha segue como veio', async () => {
  crops.length = 0;
  const out = await fitCarousel([], [vid('v1'), photo('a', 9 / 16), photo('b', 1.5), photo('fail-c', 1)]);
  assert.deepEqual(out.map((a) => a.uri), ['v1', 'a#0.800', 'b#0.800', 'fail-c']);
  assert.equal(out[1].ratio, 0.8); assert.equal(out[1].mime, 'image/jpeg');
  assert.equal(out[3].mime, 'image/png'); assert.equal(out[3].ratio, undefined);
  // Já há fotos: manda a primeira das que já lá estão (pela ratio guardada, sem a ler).
  const cur = [{ uri: 'old', video: false, mime: 'image/jpeg', tags: [], ratio: 1.91 }];
  const out2 = await fitCarousel(cur, [photo('d', 0.8)]);
  assert.deepEqual(out2.map((a) => [a.uri, a.ratio]), [['d#1.910', 1.91]]);
  // Só vídeos: nada a fazer.
  const vs = [vid('v2')];
  assert.equal(await fitCarousel(cur, vs), vs);
  // Primeira foto ilegível: a proporção vem da seguinte.
  const out3 = await fitCarousel([], [photo('x', null), photo('y', 1), photo('z', 0.8)]);
  assert.deepEqual(out3.map((a) => a.uri), ['x', 'y#1.000', 'z#1.000']);
});

test('fitCarousel: dois lotes em paralelo com o mesmo estado de partida escolhem proporções diferentes (risco em appendAssets)', async () => {
  // appendAssets passa `assets` da renderização em que foi chamado: um 2.º lote começado antes do 1.º acabar ainda vê [].
  const [l1, l2] = await Promise.all([fitCarousel([], [photo('p1', 1.91), photo('p2', 1)]), fitCarousel([], [photo('q1', 0.8), photo('q2', 1)])]);
  assert.equal(l1[1].ratio, 1.91);
  assert.equal(l2[1].ratio, 0.8);
});

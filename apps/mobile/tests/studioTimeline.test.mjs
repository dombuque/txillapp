// Estúdio das tchekas, a linha do tempo: escala e zoom à volta do dedo, régua, frames, íman nas junções, reordenar,
// o cursor à vista e os atalhos do teclado (espaço, S, Delete, Ctrl+Z, Ctrl+Shift+Z, setas). E a ligação no estúdio.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const t = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'timeline.ts')).href);
const k = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'keys.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('escala: limites e caber tudo na largura', () => {
  assert.equal(t.clampPps(1), t.PPS_MIN);
  assert.equal(t.clampPps(10_000), t.PPS_MAX);
  assert.equal(t.clampPps(Number.NaN), t.PPS_DEFAULT);
  near(t.fitPps(20, 400, 0), 20);
  assert.equal(t.fitPps(60, 340, 0) >= t.PPS_MIN, true);
});

test('o zoom deixa o instante debaixo do dedo no mesmo sítio', () => {
  const o = { pps: 50, factor: 2, anchorX: 100, scrollLeft: 300, pad: 150 };
  const tBefore = (o.scrollLeft + o.anchorX - o.pad) / o.pps;
  const z = t.zoomAt(o);
  assert.equal(z.pps, 100);
  near((z.scrollLeft + o.anchorX - o.pad) / z.pps, tBefore);
  assert.equal(t.zoomAt({ ...o, factor: 1000 }).pps, t.PPS_MAX);
  assert.equal(t.zoomAt({ pps: 50, factor: 0.5, anchorX: 0, scrollLeft: 0, pad: 0 }).scrollLeft, 0, 'nunca negativo');
});

test('régua: marcas pequenas e grandes conforme o zoom; ao máximo, frames', () => {
  const far = t.rulerTicks(10, 60);
  assert.ok(far.minor >= 1 && far.major >= 5, `afastado: ${far.minor}/${far.major}`);
  const mid = t.rulerTicks(56, 10);
  assert.equal(mid.major, 1);
  assert.equal(mid.ticks.find((x) => x.t === 3).label, '0:03');
  const close = t.rulerTicks(t.PPS_MAX, 2);
  near(close.minor, 1 / t.FPS);
  assert.ok(close.ticks.length > 50);
  assert.equal(t.rulerLabel(65), '1:05');
  assert.equal(t.rulerLabel(5.5, 0.5), '0:05,5');
  assert.equal(t.rulerLabel(5 + 10 / 30, 1 / 30), '10f');
  assert.equal(t.preciseClock(7.46), '0:07,4');
  assert.equal(t.preciseClock(-3), '0:00,0');
});

test('um frame para a frente e para trás, sempre na grelha e dentro da sequência', () => {
  near(t.stepFrame(1, 1, 10), 1 + 1 / 30);
  near(t.stepFrame(1.01, -1, 10), 29 / 30);
  assert.equal(t.stepFrame(0, -1, 10), 0);
  near(t.stepFrame(10, 1, 10), 299 / 30, 1e-9);
});

test('íman nas junções e o lugar ao reordenar', () => {
  const cuts = t.cutPoints([3, 6, 3]);
  assert.deepEqual(cuts, [0, 3, 9, 12]);
  assert.equal(t.snapTime(3.05, cuts, 100), 3, 'a 5 px de uma junção cola');
  assert.equal(t.snapTime(3.1, cuts, 100), 3.1, 'a 10 px já não');
  assert.equal(t.snapTime(3.5, cuts, 100), 3.5);
  assert.equal(t.reorderIndex(-50, 64, 4), 0);
  assert.equal(t.reorderIndex(130, 64, 4), 2);
  assert.equal(t.reorderIndex(9999, 64, 4), 3);
});

test('o cursor fica à vista enquanto toca: passa do meio e a linha desliza com ele', () => {
  assert.equal(t.followScroll({ x: 150, scrollLeft: 0, width: 400 }), null);
  assert.equal(t.followScroll({ x: 260, scrollLeft: 0, width: 400 }), 60);
  assert.equal(t.followScroll({ x: 10, scrollLeft: 100, width: 400 }), 0, 'recomeçou do início');
});

test('atalhos: espaço, S, Delete, Ctrl+Z, Ctrl+Shift+Z, setas; nunca ao escrever num campo', () => {
  const ev = (key, mods = {}) => ({ key, code: mods.code ?? '', ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift, altKey: false, target: mods.target ?? null });
  assert.equal(k.studioKey(ev(' ', { code: 'Space' })), 'play');
  assert.equal(k.studioKey(ev('s')), 'split');
  assert.equal(k.studioKey(ev('S')), 'split');
  assert.equal(k.studioKey(ev('Delete')), 'delete');
  assert.equal(k.studioKey(ev('Backspace')), 'delete');
  assert.equal(k.studioKey(ev('z', { ctrl: true })), 'undo');
  assert.equal(k.studioKey(ev('z', { meta: true })), 'undo', 'Cmd+Z no Mac');
  assert.equal(k.studioKey(ev('Z', { ctrl: true, shift: true })), 'redo');
  assert.equal(k.studioKey(ev('y', { ctrl: true })), 'redo');
  assert.equal(k.studioKey(ev('ArrowRight')), 'next-frame');
  assert.equal(k.studioKey(ev('ArrowLeft')), 'prev-frame');
  assert.equal(k.studioKey(ev('ArrowRight', { shift: true })), 'next-second');
  assert.equal(k.studioKey(ev('s', { ctrl: true })), null, 'Ctrl+S é do browser');
  assert.equal(k.studioKey(ev('s', { target: { tagName: 'INPUT' } })), null, 'a escrever o texto, nada');
  assert.equal(k.studioKey(ev(' ', { target: { tagName: 'TEXTAREA' } })), null);
  assert.equal(k.studioKey(ev('Delete', { target: { isContentEditable: true } })), null);
  assert.equal(k.studioKey(ev('x')), null);
});

test('o estúdio liga a linha do tempo, os atalhos e o bloqueio da montagem', () => {
  const studio = read('components', 'TchekaStudio.tsx');
  assert.match(studio, /<Timeline\b/);
  assert.match(studio, /studioKey\(/);
  // Os atalhos não fazem nada com a montagem em curso (nem com o seletor de música aberto).
  assert.match(studio, /if \(editLocked\(progressRef\.current\) \|\| pickOpen\.current\) return;/);
  // A linha do tempo está dentro da caixa que fica bloqueada durante a montagem.
  const box = studio.indexOf("pointerEvents={locked ? 'none' : 'auto'}");
  const tl = studio.indexOf('<Timeline');
  const end = studio.indexOf('{pickMusic ? <MusicPicker');
  assert.ok(box > 0 && tl > box && tl < end, 'a linha do tempo fica na caixa bloqueada');
  assert.match(studio, /locked=\{locked\}/);
  const timeline = read('components', 'studio', 'Timeline.tsx');
  assert.match(timeline, /if \(locked\) return;/, 'a linha do tempo ignora os gestos bloqueada');
  // As ações do clipe escolhido.
  for (const a of ['Dividir', 'Duplicar', 'Velocidade', 'Apagar', 'Substituir']) assert.match(read('components', 'studio', 'TimelineActions.tsx'), new RegExp(`'${a}'`));
  // Zoom: pinça, Ctrl + roda e botões.
  assert.match(timeline, /ctrlKey/);
  assert.match(timeline, /pinchDistance\(/);
  assert.match(timeline, /'Aproximar'/);
  assert.match(timeline, /'Afastar'/);
  // Toque leve ao chegar ao mínimo.
  assert.match(timeline, /vibrate/);
});

test('computador (≥ 1024 px): o estúdio usa a janela toda — palco ao centro, painéis à direita, linha do tempo em baixo', () => {
  const studio = read('components', 'TchekaStudio.tsx');
  assert.match(studio, /const wide = useDesktop\(\);/);
  assert.match(studio, /setStudioFull\(true\); return \(\) => setStudioFull\(false\);/);
  assert.match(studio, /<View style=\{wide \? \[st\.panelWide, \{ top: stage\.y, height: stage\.h \}\] : null\}>/);
  // A linha do tempo tem a caixa bloqueada dela (fora dos painéis) e o inert vale para as duas.
  assert.match(studio, /for \(const box of \[editBox\.current, timelineBox\.current\]\)/);
  const shell = read('components', 'DesktopShell.tsx');
  assert.match(shell, /const studio = useStudioFull\(\) && path === '\/new';/);
  assert.match(shell, /<View style=\{studio \? st\.hidden : st\.sideWrap\}>/);
  assert.match(read('components', 'DesktopShortcuts.tsx'), /isStudioFull\(\)\) return;/, 'os atalhos do site calam-se no estúdio');
});

test('a pinça conta os dedos em toda a linha do tempo (também em cima do «+» e dos botões)', () => {
  const timeline = read('components', 'studio', 'Timeline.tsx');
  assert.match(timeline, /onPointerDownCapture=\{onPointerDownCapture\}/);
  assert.match(timeline, /for \(const id of pointers\.current\.keys\(\)\) \{ try \{ w\.setPointerCapture\(id\);/);
  assert.match(timeline, /touchAction: 'none'/);
});

test('a barra do tempo fica por baixo da imagem, com a largura dela; um só play à vista', () => {
  const studio = read('components', 'TchekaStudio.tsx');
  assert.match(studio, /<View style=\{\[st\.controls, \{ left: imgBox\.left, width: imgBox\.w \}\]\}/);
  assert.match(studio, /height: `calc\(100% - \$\{BAR_H\}px\)`/, 'a imagem deixa a faixa da barra livre');
  // O play grande só em pausa (e sem camada escolhida, para não tapar o texto que se mexe); a tocar, o pequeno da barra é a pausa.
  assert.match(studio, /\{!playing && !busy && !selOv \? <View style=\{\[st\.center, \{ bottom: BAR_H \}\]\}/);
  assert.match(studio, /\{!busy && playing \? \(/);
});

test('as velocidades passam para a linha seguinte quando não cabem, com alvos de toque de 44 px', () => {
  const actions = read('components', 'studio', 'TimelineActions.tsx');
  const row = actions.slice(actions.indexOf('const row: CSSProperties'), actions.indexOf('\n', actions.indexOf('const row: CSSProperties')));
  assert.match(row, /flexWrap: 'wrap'/);
  assert.doesNotMatch(row, /overflowX/, 'as velocidades não rolam: passam para baixo');
  assert.match(actions, /height: 44, minWidth: 44, padding: '0 10px'/);
});

// O vídeo no visor em ecrã inteiro (PhotoViewer) ocupa o ecrã, como nas tchekas: no iPhone do dono (1.59.1) um vídeo em
// pé ficava numa caixa entre o «×  3/3» e a legenda, com margens pretas. Em pé num telemóvel enche (cover); deitado,
// quadrado ou no computador fica inteiro (contain), centrado no ecrã todo. O cabeçalho e a legenda flutuam por cima.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');
const vf = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'viewerFit.ts')).href);

const phone = { w: 390, h: 844 };
const desk = { w: 1440, h: 900 };

test('vídeo em pé num telemóvel: cover (enche de cima a baixo)', () => {
  assert.equal(vf.viewerVideoFit({ w: 1080, h: 1920 }, phone), 'cover', '9:16');
  assert.equal(vf.viewerVideoFit({ w: 720, h: 1280 }, phone), 'cover');
  assert.equal(vf.viewerVideoFit({ w: 1000, h: 1500 }, phone), 'cover', '2:3, no limite');
  assert.equal(vf.viewerVideoFit({ w: 1080, h: 2340 }, phone), 'cover', 'mais alto do que o ecrã');
});

test('vídeo deitado, quadrado ou 4:5: contain (inteiro, centrado no ecrã todo)', () => {
  assert.equal(vf.viewerVideoFit({ w: 1920, h: 1080 }, phone), 'contain', '16:9');
  assert.equal(vf.viewerVideoFit({ w: 1080, h: 1080 }, phone), 'contain', 'quadrado');
  assert.equal(vf.viewerVideoFit({ w: 1080, h: 1350 }, phone), 'contain', '4:5 corta demasiado');
  assert.equal(vf.viewerVideoFit({ w: 1000, h: 1490 }, phone), 'contain', 'pouco abaixo de 1,5');
});

test('no computador (ecrã deitado) o vídeo em pé fica inteiro, sem cortes', () => {
  assert.equal(vf.viewerVideoFit({ w: 1080, h: 1920 }, desk), 'contain');
  assert.equal(vf.viewerVideoFit({ w: 1920, h: 1080 }, desk), 'contain');
  assert.equal(vf.viewerVideoFit({ w: 1080, h: 1920 }, { w: 1024, h: 1100 }), 'contain', 'tablet quase quadrado');
});

test('sem tamanho conhecido: contain; o da publicação manda, senão o do vídeo quando carrega', () => {
  assert.equal(vf.viewerVideoFit(null, phone), 'contain');
  assert.equal(vf.viewerVideoFit({ w: 0, h: 0 }, phone), 'contain');
  assert.equal(vf.viewerVideoFit({ w: 1080, h: 1920 }, { w: 0, h: 0 }), 'contain');
  assert.deepEqual(vf.mediaSize({ width: 1080, height: 1920 }, { w: 1920, h: 1080 }), { w: 1080, h: 1920 });
  assert.deepEqual(vf.mediaSize({ width: null, height: null }, { w: 720, h: 1280 }), { w: 720, h: 1280 });
  assert.deepEqual(vf.mediaSize({}, null), null);
  assert.deepEqual(vf.mediaSize(undefined, { w: 0, h: 10 }), null);
});

test('cada página do pager tem o tamanho do ecrã inteiro', () => {
  assert.deepEqual(vf.viewerPage(phone), { w: 390, h: 844 });
  assert.deepEqual(vf.viewerPage({ w: 390.4, h: 843.6 }), { w: 390, h: 844 });
  assert.deepEqual(vf.viewerPage({ w: -1, h: 10 }), { w: 0, h: 10 });
});

test('legenda: no máximo 3 linhas, «mais» só quando passa', () => {
  assert.equal(vf.CAPTION_LINES, 3);
  assert.equal(vf.captionTooLong('', 390), false);
  assert.equal(vf.captionTooLong(null, 390), false);
  assert.equal(vf.captionTooLong('Fim de semana na Costa do Sol', 390), false);
  const dono = 'Não me convidem para sair... sou uma péssima influência! Era só para irmos tomar um cocktail, mas acabei por convencer toda a gente de que estávamos com fome.';
  assert.equal(vf.captionTooLong(dono, 390), true, 'a legenda da captura do dono passa as 3 linhas no telemóvel');
  assert.equal(vf.captionTooLong(dono, 1440), false, 'no computador cabe');
  assert.equal(vf.captionTooLong('a\nb\nc', 390), false);
  assert.equal(vf.captionTooLong('a\nb\nc\nd', 390), true, 'quatro parágrafos');
});

test('PhotoViewer: o pager ocupa o ecrã inteiro; cabeçalho e legenda flutuam por cima com degradê', () => {
  const pv = read('components', 'PhotoViewer.tsx');
  assert.match(pv, /pager: \{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 \}/, 'o pager enche o ecrã (não fica entre o cabeçalho e a legenda)');
  assert.match(pv, /<Animated\.View style=\{\[styles\.pager, \{ transform: \[\{ translateY: drag \}\] \}\]\}/);
  assert.match(pv, /const page = viewerPage\(\{ w: width, h: pagerH \}\);/);
  assert.match(pv, /useState\(Math\.round\(height\)\)/, 'começa com a altura do ecrã (não 60%)');
  assert.match(pv, /<Photo photo=\{item\} w=\{page\.w\} h=\{page\.h\}/, 'as fotos também no ecrã inteiro (sem saltos ao deslizar)');
  assert.match(pv, /const fit = viewerVideoFit\(mediaSize\(item, nat\), \{ w, h \}\);/);
  assert.match(pv, /top: \{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 4/);
  assert.match(pv, /foot: \{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 4/);
  assert.equal((pv.match(/<LinearGradient /g) ?? []).length, 2, 'degradê em cima e em baixo');
  assert.doesNotMatch(pv, /foot: \{ backgroundColor/, 'sem a faixa preta por baixo do vídeo');
  // A ordem: o pager por baixo de tudo, depois o cabeçalho, a fila de ações e a legenda.
  const body = pv.slice(pv.indexOf('<Modal visible'));
  assert.ok(body.indexOf('styles.pager') < body.indexOf('styles.top'));
  assert.ok(body.indexOf('styles.top') < body.indexOf('styles.rail'));
  assert.ok(body.indexOf('styles.rail') < body.indexOf('styles.foot'));
  // A legenda: 3 linhas com «mais», abre e fecha.
  assert.match(pv, /<Text numberOfLines=\{CAPTION_LINES\} style=\{styles\.body\}>/);
  assert.match(pv, /\{longCaption \? <Text style=\{styles\.more\}>\{t\('mais'\)\}<\/Text> : null\}/);
  assert.match(pv, /<Text style=\{styles\.more\}>\{t\('menos'\)\}<\/Text>/);
  // O botão do som fica acima da legenda; a fila de ações também.
  assert.match(pv, /soundBottom=\{footH \+ 10\}/);
  assert.match(pv, /styles\.rail, \{ bottom: footH \+ 12 \}/);
});

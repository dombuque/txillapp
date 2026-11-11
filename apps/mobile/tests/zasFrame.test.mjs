// Testes das contas do enquadramento da câmara do Zás (src/components/zas/zasFrame.ts): a imagem cobre SEMPRE a forma
// (sem barras nem cantos vazios), em qualquer formato de câmara (4:3, 16:9, deitada, quadrada), e a foto tirada é
// exatamente a parte que se viu (o mesmo corte "cover", o mesmo zoom e o mesmo espelho na câmara da frente).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const F = await import(pathToFileURL(path.join(ROOT, 'src', 'components', 'zas', 'zasFrame.ts')).href);

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

// Formatos que as câmaras dão de facto: 3:4 e 9:16 ao alto, 4:3 e 16:9 deitados (webcams, iPhone a rodar), quadrado.
const STREAMS = [[1080, 1440], [1440, 1080], [720, 1280], [1280, 720], [1920, 1080], [640, 480], [480, 480], [3024, 4032], [1, 1000]];
// Cartões: o normal (0,75), a legenda aberta (a área toda, quase quadrada ou muito alta), ecrãs pequenos e grandes.
const CARDS = [[300, 400], [243, 324], [390, 560], [360, 200], [412, 800], [600, 450], [1, 1], [333, 444]];

test('tamanho do cartão: proporção 0,75 exata, limites, nunca negativo', () => {
  for (const [w, h] of [[390, 500], [320, 300], [1024, 900], [100, 1000], [64, 400], [0, 0], [-10, -10], [NaN, 400]]) {
    const c = F.zasCardSize(w, h);
    assert.ok(c.w >= 0 && c.h >= 0, `não negativo para ${w}×${h}`);
    if (c.w > 0) {
      assert.equal(c.w * 4, c.h * 3, `0,75 exata para ${w}×${h}`);
      assert.equal(c.w % 3, 0);
      assert.ok(c.w <= w - 64 + 1e-9, 'cabe na largura com margem');
      assert.ok(c.h <= Math.min(520, h), 'cabe na altura e no máximo');
    }
  }
  assert.deepEqual(F.zasCardSize(390, 2000), { w: 324, h: 432 }); // estreito: manda a largura
  assert.deepEqual(F.zasCardSize(1024, 2000), { w: 390, h: 520 }); // largo: manda o máximo de altura
  assert.deepEqual(F.zasCardSize(40, 400), { w: 0, h: 0 });
});

test('cover: a imagem cobre a caixa toda, centrada, sem deformar (todos os formatos e cartões)', () => {
  for (const [sw, sh] of STREAMS) {
    for (const [bw, bh] of CARDS) {
      for (const zoom of [1, 1.7, 4]) {
        const b = F.coverBox(bw, bh, sw, sh, zoom);
        // Sem espaço vazio: começa antes (ou no) canto de cima/esquerda e acaba depois (ou no) de baixo/direita.
        assert.ok(b.left <= 1e-9 && b.top <= 1e-9, `começa fora (${sw}×${sh} em ${bw}×${bh})`);
        assert.ok(b.left + b.width >= bw - 1e-9 && b.top + b.height >= bh - 1e-9, `acaba fora (${sw}×${sh} em ${bw}×${bh})`);
        // Pelo menos um dos lados encosta (sem zoom): é "cover", não ampliado à toa.
        if (zoom === 1) assert.ok(Math.abs(b.width - bw) < 1e-6 || Math.abs(b.height - bh) < 1e-6);
        // Centrada e com a proporção da câmara.
        near(b.left * 2 + b.width, bw, 1e-6);
        near(b.top * 2 + b.height, bh, 1e-6);
        near(b.width / b.height, sw / sh, 1e-9);
      }
    }
  }
});

test('cover sem medidas da câmara (antes do loadedmetadata): ocupa a caixa toda', () => {
  assert.deepEqual(F.coverBox(300, 400, 0, 0), { left: 0, top: 0, width: 300, height: 400 });
  assert.deepEqual(F.coverBox(0, 400, 1080, 1440), { left: 0, top: 0, width: 0, height: 0 });
  const z = F.coverBox(300, 400, NaN, 10, 2);
  assert.deepEqual(z, { left: -150, top: -200, width: 600, height: 800 });
});

test('câmara 3:4 num cartão 3:4: a imagem é o cartão, sem corte nenhum', () => {
  assert.deepEqual(F.coverBox(300, 400, 1080, 1440), { left: 0, top: 0, width: 300, height: 400 });
  assert.deepEqual(F.coverCrop(1080, 1440), { sx: 0, sy: 0, sw: 1080, sh: 1440 });
});

test('recorte da foto: proporção 0,75, centrado, dentro da imagem', () => {
  for (const [sw, sh] of STREAMS) {
    for (const zoom of [1, 2, 4]) {
      const c = F.coverCrop(sw, sh, F.ZAS_ASPECT, zoom);
      near(c.sw / c.sh, 0.75, 1e-9);
      assert.ok(c.sx >= -1e-9 && c.sy >= -1e-9 && c.sx + c.sw <= sw + 1e-9 && c.sy + c.sh <= sh + 1e-9);
      near(c.sx * 2 + c.sw, sw, 1e-6); // centrado na horizontal: espelhar antes ou depois dá o mesmo
      near(c.sy * 2 + c.sh, sh, 1e-6);
      if (zoom === 1) assert.ok(Math.abs(c.sw - sw) < 1e-6 || Math.abs(c.sh - sh) < 1e-6, 'sem zoom aproveita a imagem toda num dos lados');
    }
  }
  // 16:9 deitado (webcam): fica o meio, 810 × 1080.
  assert.deepEqual(F.coverCrop(1920, 1080), { sx: 555, sy: 0, sw: 810, sh: 1080 });
  // 9:16 ao alto: corta em cima e em baixo.
  assert.deepEqual(F.coverCrop(1080, 1920), { sx: 0, sy: 240, sw: 1080, sh: 1440 });
});

test('WYSIWYG: o que a pré-visualização mostra num cartão 0,75 é exatamente o recorte da foto', () => {
  for (const [sw, sh] of STREAMS) {
    for (const [bw, bh] of [[300, 400], [243, 324], [390, 520]]) {
      for (const zoom of [1, 1.5, 3]) {
        const b = F.coverBox(bw, bh, sw, sh, zoom);
        // A parte da imagem visível na caixa, em píxeis da câmara.
        const k = b.width / sw;
        const vis = { sx: -b.left / k, sy: -b.top / k, sw: bw / k, sh: bh / k };
        const c = F.coverCrop(sw, sh, bw / bh, zoom);
        for (const key of ['sx', 'sy', 'sw', 'sh']) near(vis[key], c[key], 1e-6 * Math.max(sw, sh));
      }
    }
  }
});

test('WYSIWYG com espelho (câmara da frente): espelhar a parte visível = recortar a imagem espelhada', () => {
  // Um ponto da imagem em (px, py) aparece no ecrã espelhado; na foto espelhada tem de cair no mesmo sítio relativo.
  const [sw, sh] = [1280, 720];
  const c = F.coverCrop(sw, sh);
  for (const px of [c.sx + 1, c.sx + c.sw / 3, c.sx + c.sw - 1]) {
    const onScreen = 1 - (px - c.sx) / c.sw; // posição relativa no ecrã (espelhado)
    const mirroredX = sw - px; // o mesmo ponto na imagem espelhada
    const inPhoto = (mirroredX - c.sx) / c.sw; // e na foto (recorte da imagem espelhada)
    near(onScreen, inPhoto, 1e-9);
  }
});

test('recorte em píxeis inteiros nunca sai da imagem', () => {
  for (const [sw, sh] of [[641, 479], [1281, 721], [3, 1000], [999, 1]]) {
    for (const zoom of [1, 1.33, 3.7]) {
      const r = F.roundCrop(F.coverCrop(sw, sh, 0.75, zoom), sw, sh);
      for (const v of Object.values(r)) assert.ok(Number.isInteger(v));
      assert.ok(r.sx >= 0 && r.sy >= 0 && r.sw >= 1 && r.sh >= 1 && r.sx + r.sw <= sw && r.sy + r.sh <= sh, JSON.stringify({ sw, sh, r }));
    }
  }
});

test('tamanho final: até 1080 de largura, sem ampliar, proporção mantida', () => {
  assert.deepEqual(F.outSize(1512, 2016), { w: 1080, h: 1440 });
  assert.deepEqual(F.outSize(810, 1080), { w: 810, h: 1080 });
  assert.deepEqual(F.outSize(0, 100), { w: 0, h: 0 });
  // Zoom digital forte no site: o recorte pequeno é ampliado até 720 de largura (nunca acima do máximo).
  assert.deepEqual(F.outSize(180, 240, 1080, 720), { w: 720, h: 960 });
  assert.deepEqual(F.outSize(1512, 2016, 1080, 720), { w: 1080, h: 1440 });
  assert.deepEqual(F.outSize(180, 240, 600, 720), { w: 600, h: 800 });
});

test('pinça: zoom dentro dos limites', () => {
  assert.equal(F.pinchZoom(1, 2), 2);
  assert.equal(F.pinchZoom(3, 2), F.ZAS_MAX_ZOOM);
  assert.equal(F.pinchZoom(1, 0.3), 1);
  assert.equal(F.pinchZoom(2, NaN), 2);
  assert.equal(F.pinchZoom(0.5, 1, 0.5, 8), 0.5); // Android com ultra grande angular: pode descer abaixo de 1
});

test('tocar para focar: o ponto do toque na imagem da câmara (cover, zoom e espelho)', () => {
  // Câmara 4:3 deitada num cartão 300×400: a imagem tem 533,3 × 400 e passa 116,7 de cada lado.
  const mid = F.tapToSource(150, 200, 300, 400, 640, 480);
  near(mid.x, 0.5); near(mid.y, 0.5);
  const left = F.tapToSource(0, 0, 300, 400, 640, 480);
  near(left.x, (533.333333 - 300) / 2 / 533.333333, 1e-6); near(left.y, 0);
  // Espelhada: o lado esquerdo do ecrã é o direito da câmara.
  const leftMirror = F.tapToSource(0, 0, 300, 400, 640, 480, 1, true);
  near(leftMirror.x, 1 - left.x, 1e-9);
  // Com zoom 2, o canto do cartão fica mais perto do centro da imagem.
  const z = F.tapToSource(0, 0, 300, 400, 1080, 1440, 2);
  near(z.x, 0.25); near(z.y, 0.25);
  assert.equal(F.tapToSource(10, 10, 0, 0, 640, 480), null);
});

test('espelho da foto nativa e gestos', () => {
  assert.equal(F.needsMirror(true, false), true);
  assert.equal(F.needsMirror(true, true), false);
  assert.equal(F.needsMirror(false, false), false);
  assert.equal(F.isTap(3, 4, 120), true);
  assert.equal(F.isTap(30, 0, 120), false);
  assert.equal(F.isTap(0, 0, 900), false);
  assert.equal(F.inCaptionZone(100, 400), true);
  assert.equal(F.inCaptionZone(200, 400), false);
});

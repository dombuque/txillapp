// A foto do mimo como no Instagram: entra inteira (sem o recorte 9:16 obrigatório do sistema), com zoom e arrastar no editor,
// e o que se vê na moldura é o que se publica (src/lib/mimoCrop.ts). E a bolha de foto da conversa com a forma da foto.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const m = await import(new URL('../src/lib/mimoCrop.ts', import.meta.url).href);
const sf = await import(new URL('../src/lib/storyFrame.ts', import.meta.url).href);
const cl = await import(new URL('../src/lib/chatLayout.ts', import.meta.url).href);
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r/g, '');
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b}`);

const LAND = { w: 4000, h: 3000 }; // foto deitada 4:3
const WIDE = { w: 1920, h: 1080 }; // 16:9
const TALL = { w: 3000, h: 4000 }; // em pé 3:4
const STORY = { w: 1080, h: 1920 }; // já 9:16
const F0 = m.mimoFrame(390, 844); // a moldura de um telemóvel de 390 px
const F = { w: F0.w, h: F0.h };

test('a moldura é 9:16 ao centro do ecrã do editor, a maior que cabe', () => {
  for (const [w, h] of [[390, 844], [430, 932], [375, 667], [1440, 900], [1280, 620], [820, 1180]]) {
    const f = m.mimoFrame(w, h);
    near(f.w / f.h, 9 / 16, 1e-9, `${w}x${h}`);
    assert.ok(f.w <= w + 1e-9 && f.h <= h + 1e-9, `${w}x${h} cabe`);
    assert.ok(Math.abs(f.w - w) < 1e-9 || Math.abs(f.h - h) < 1e-9, `${w}x${h} encosta a um lado`);
    near(f.x * 2 + f.w, w, 1e-9);
    near(f.y * 2 + f.h, h, 1e-9);
  }
  assert.deepEqual(m.mimoFrame(0, 0), { x: 0, y: 0, w: 0, h: 0 });
});

test('zoom: entre inteira (1) e 4x; numa foto muito deitada vai até ao dobro de preencher', () => {
  assert.equal(m.clampView({ z: 0.3, tx: 0, ty: 0 }, LAND, F).z, 1);
  assert.equal(m.clampView({ z: 99, tx: 0, ty: 0 }, TALL, F).z, 4);
  const cover = m.coverZoom(WIDE, F);
  near(cover, (16 / 9) / (9 / 16), 1e-3, '16:9 numa moldura 9:16');
  near(m.maxZoom(WIDE, F), cover * 2, 1e-9);
  near(m.coverZoom(STORY, F), 1, 1e-3, 'uma foto 9:16 já preenche');
  assert.equal(m.clampView({ z: NaN, tx: NaN, ty: 5 }, LAND, F).z, 1);
});

test('inteira fica ao centro; com zoom não deixa aparecer fundo no eixo em que a foto é maior', () => {
  assert.deepEqual(m.clampView({ z: 1, tx: 50, ty: -80 }, LAND, F), { z: 1, tx: 0, ty: 0 });
  const z = 2;
  const v = m.clampView({ z, tx: 9999, ty: 9999 }, LAND, F);
  const b = m.shownBox(v, LAND, F);
  near(b.x, 0, 1e-6, 'encostada à esquerda');
  // A foto deitada a 2x ainda não chega à altura da moldura: fica ao centro na vertical.
  assert.ok(b.h < F.h);
  near(v.ty, 0);
  const f = m.fillView(LAND, F);
  const fb = m.shownBox(m.panBy(f, 0, 0, LAND, F), LAND, F);
  near(fb.h, F.h, 1e-6, 'preencher: a altura da moldura');
  assert.ok(fb.w >= F.w);
});

test('zoom com os dedos: o ponto debaixo dos dedos fica parado', () => {
  const v0 = m.fillView(LAND, F);
  const fx = 300, fy = 200;
  const b0 = m.shownBox(v0, LAND, F);
  const u = (fx - b0.x) / b0.w, w = (fy - b0.y) / b0.h; // onde, na foto, estão os dedos
  const v1 = m.zoomAt(v0, v0.z * 1.5, fx, fy, LAND, F);
  const b1 = m.shownBox(v1, LAND, F);
  near(b1.x + u * b1.w, fx, 1e-6, 'x');
  near(b1.y + w * b1.h, fy, 1e-6, 'y');
  // Diminuir até ao fim volta a inteira, ao centro.
  assert.deepEqual(m.zoomAt(v1, 0.1, 10, 10, LAND, F), { z: 1, tx: 0, ty: 0 });
});

test('duplo toque e o botão: inteira ⇄ preencher', () => {
  const f = m.toggleView(m.WHOLE, LAND, F);
  near(f.z, m.coverZoom(LAND, F));
  assert.equal(m.isWhole(f), false);
  assert.deepEqual(m.toggleView(f, LAND, F), m.WHOLE);
  assert.deepEqual(m.toggleView({ z: 3.3, tx: 20, ty: 0 }, LAND, F), m.WHOLE);
  // Uma foto 9:16 não tem «preencher» diferente de inteira.
  assert.deepEqual(m.toggleView(m.WHOLE, STORY, F), m.WHOLE);
});

test('inteira: publica-se a original (sem recorte)', () => {
  assert.equal(m.mimoCrop(m.WHOLE, LAND, F), null);
  assert.equal(m.mimoCrop({ z: 1.001, tx: 0, ty: 0 }, LAND, F), null);
  assert.equal(m.mimoCrop({ z: 2, tx: 0, ty: 0 }, null, F), null);
});

test('preencher: recorte 9:16 ao centro, até 1080×1920, e o visor mostra-o a preencher o cartão', () => {
  for (const img of [LAND, WIDE, TALL, { w: 12000, h: 9000 }]) {
    const c = m.mimoCrop(m.fillView(img, F), img, F);
    if (img === TALL) {
      // 3:4 em pé numa moldura 9:16: preencher corta os lados.
      assert.ok(c.h === 1 && c.w < 1);
    }
    near((c.w * img.w) / (c.h * img.h), 9 / 16, 1e-6, `forma ${img.w}x${img.h}`);
    near(c.x + c.w / 2, 0.5, 1e-9, 'ao centro');
    near(c.y + c.h / 2, 0.5, 1e-9, 'ao centro');
    assert.ok(c.outW <= 1080 && c.outH <= 1920, `${c.outW}x${c.outH}`);
    near(c.outW / c.outH, 9 / 16, 0.002, 'JPEG 9:16');
    assert.ok(c.outW <= c.w * img.w + 1 && c.outH <= c.h * img.h + 1e-6, 'nunca se aumenta');
    // O visor (lib/storyFrame mimoFit) mostra uma foto 9:16 em cover, a preencher o cartão.
    for (const [cw, ch] of [[390, 693], [460, 818], [320, 569]]) assert.equal(sf.mimoFit(c.outW / c.outH, cw, ch), 'cover');
  }
  // 12000x9000: o recorte tem 5062x9000 px; o JPEG fica 1080x1920 (com casas, sem 1 px a mais ou a menos).
  const big = m.mimoCrop(m.fillView({ w: 12000, h: 9000 }, F), { w: 12000, h: 9000 }, F);
  assert.deepEqual([big.outW, big.outH], [1080, 1920]);
});

test('com zoom e arrastada: vai a parte que está dentro da moldura, na resolução que tem', () => {
  const fill = m.mimoCrop(m.fillView(LAND, F), LAND, F);
  const v = m.zoomAt(m.fillView(LAND, F), m.coverZoom(LAND, F) * 2, 0, 0, LAND, F); // zoom no canto de cima à esquerda
  const c = m.mimoCrop(v, LAND, F);
  near(c.x, fill.x, 1e-9, 'o canto da moldura fica no mesmo sítio da foto');
  near(c.y, 0, 1e-9);
  near(c.w, fill.w / 2, 1e-9, 'metade da largura de preencher');
  near(c.h, 0.5, 1e-9);
  // Arrastar até à direita: a parte da direita da foto.
  const r = m.mimoCrop(m.panBy(v, -99999, 0, LAND, F), LAND, F);
  near(r.x + r.w, 1, 1e-9);
  // 1688x1500 px de foto → até 1080x1920: limita a largura; não se aumenta.
  assert.ok(c.outW <= 1080);
  assert.ok(Math.abs(c.outW - Math.min(1080, c.w * LAND.w)) <= 1);
  // Uma foto pequena não cresce.
  const small = { w: 800, h: 600 };
  const s = m.mimoCrop(m.fillView(small, F), small, F);
  assert.equal(s.outH, 600);
  assert.equal(s.outW, Math.round(600 * 9 / 16));
});

test('zoom entre inteira e preencher: recorte só no eixo que transborda, e o visor mostra-o inteiro ao centro', () => {
  const c = m.mimoCrop({ z: 2, tx: 30, ty: 0 }, LAND, F);
  assert.equal(c.h, 1, 'a altura inteira');
  assert.ok(c.w < 1);
  near((c.w * LAND.w) / (c.h * LAND.h), F.w / (LAND.h * m.containScale(LAND, F) * 2), 1e-6, 'a forma do que se vê');
  assert.equal(sf.mimoFit(c.outW / c.outH, 390, 693), 'contain');
});

test('o editor do mimo: sem o recorte do sistema, com zoom, botão honesto e o recorte ao publicar', () => {
  const s = read('app/stories/new.tsx');
  assert.doesNotMatch(s, /allowsEditing:/);
  assert.doesNotMatch(s, /aspect: \[9, 16\]/);
  assert.match(s, /mediaTypes: \['images', 'videos'\], quality: 0\.85, videoMaxDuration: 30 \}/);
  assert.match(s, /<MimoPhoto uri=\{asset\.uri\} width=\{frame\.w\} height=\{frame\.h\} view=\{view\} onView=\{setView\}/);
  assert.match(s, /setView\(whole \? fillView\(img, fsize\) : WHOLE\)/);
  assert.match(s, /whole \? t\('Preencher o ecrã'\) : t\('Mostrar a foto inteira'\)/);
  assert.match(s, /const crop = !a\.video && img \? mimoCrop\(view, img, fsize\) : null;/);
  assert.match(s, /crop \? await cropRegion\(a\.uri, crop, crop\.outW, crop\.outH\) : await shrinkPhoto\(a\.uri\)/);
  // Os stickers vivem na moldura (as posições relativas são as do cartão do visor).
  assert.match(s, /<StickerCanvas stickers=\{stickers\} onChange=\{setStickers\} width=\{frame\.w\} height=\{frame\.h\}/);
  // Os botões por cima não tapam os gestos na foto.
  assert.match(s, /<View pointerEvents="box-none" style=\{\[st\.top/);
  assert.match(s, /<View pointerEvents="box-none" style=\{\[st\.bottom/);
  const p = read('components/MimoPhoto.tsx');
  assert.match(p, /usePinchGesture\(/);
  assert.match(p, /usePanGesture\(/);
  assert.match(p, /numberOfTaps: 2/);
  assert.match(p, /addEventListener\('wheel', onWheel, \{ passive: false \}\)/);
  // O recorte existe no telemóvel (Skia) e no site (canvas).
  for (const f of ['lib/cropToRatio.ts', 'lib/cropToRatio.web.ts']) assert.match(read(f), /export async function cropRegion\(/, f);
});

test('publicações, conversa, grupos e respostas: a galeria não força recorte (só fotos de perfil e capas)', () => {
  for (const f of ['app/(tabs)/new.tsx', 'components/ChatComposer.tsx', 'components/GroupComposer.tsx', 'components/GalleryPicker.tsx', 'components/remix/ReplyStudio.tsx', 'components/TchekaStudio.native.tsx']) {
    assert.doesNotMatch(read(f), /allowsEditing/, f);
  }
});

test('bolha de foto: a forma da foto, inteira, com limites (como no WhatsApp)', () => {
  assert.deepEqual(cl.photoBubbleSize(null), { width: 240, height: 288 });
  assert.deepEqual(cl.photoBubbleSize(4 / 3), { width: 240, height: 180 });
  assert.deepEqual(cl.photoBubbleSize(1), { width: 240, height: 240 });
  assert.deepEqual(cl.photoBubbleSize(3 / 4), { width: 240, height: 320 });
  assert.deepEqual(cl.photoBubbleSize(9 / 16), { width: 180, height: 320 });
  assert.deepEqual(cl.photoBubbleSize(1 / 4), { width: 160, height: 320 });
  assert.deepEqual(cl.photoBubbleSize(4), { width: 240, height: 120 });
  for (const r of [0.2, 0.5, 0.75, 1, 1.5, 2, 5]) {
    const s = cl.photoBubbleSize(r);
    assert.ok(s.width >= 160 && s.width <= 240 && s.height >= 120 && s.height <= 320, String(r));
  }
  const b = read('components/ChatBubbles.tsx');
  const photo = b.slice(b.indexOf('function ChatPhoto'), b.indexOf('function QuotedMedia'));
  assert.match(photo, /photoBubbleSize\(ratio\)/);
  assert.match(photo, /contentFit="contain"/);
  assert.doesNotMatch(photo, /contentFit="cover"/);
  assert.match(photo, /photoRatios\.set\(url, r\)/);
});

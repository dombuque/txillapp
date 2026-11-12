// A qualidade das fotos da TxillCam, do pedido à câmara até ao ecrã de quem vê:
// - a resolução que o site pede ao stream (no iPhone a foto é um frame do vídeo) e o recuo se o visor ficar lento;
// - a foto final sai do original (reviewSrc), nunca da cópia de 1600 px da pré-visualização;
// - o JPEG final (92 %, ou 85 % se passar do que o servidor aceita) e o teto do ImageCapture;
// - a largura pedida ao servidor por densidade de ecrã (o feed pedia 720 num iPhone com DPR 3);
// - a largura que o editor do telemóvel (PhotoEditor) grava.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'webCamera.ts')).href);
const P = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'photoSize.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');
const CAM = read('components', 'TxCamera.tsx');

test('stream da foto: traseira do iPhone (4032×3024) sobe a 2160×2880; frontal de 1920×1440 fica em 1440×1920', () => {
  const back = { width: { min: 1, max: 4032 }, height: { min: 1, max: 3024 } };
  const up = C.photoUpgrade(back, { width: 1080, height: 1440 }, '3:4');
  assert.deepEqual(up, { width: { ideal: 2160 }, height: { ideal: 2880 }, aspectRatio: { ideal: 3 / 4 } });
  // Ao alto: a largura é o lado curto (o iPhone dá o vídeo já rodado).
  assert.ok(up.height.ideal > up.width.ideal);
  const front = { width: { max: 1920 }, height: { max: 1440 } };
  assert.deepEqual(C.photoUpgrade(front, { width: 1080, height: 1440 }, '3:4'), C.PHOTO_SAFE);
  // Um sensor no meio (2592×1944): o maior degrau da escada que cabe.
  assert.deepEqual(C.photoUpgrade({ width: { max: 2592 }, height: { max: 1944 } }, { width: 1080, height: 1440 }, '3:4').height, { ideal: 2560 });
  // Nunca acima do teto (nem com sensores de 48 MP) e só em 3:4 (o 16:9 é do vídeo, dos mimos e das tchekas).
  assert.equal(C.PHOTO_MAX_LONG, 2880);
  assert.equal(C.photoUpgrade({ width: { max: 8064 }, height: { max: 6048 } }, null, '3:4').height.ideal, 2880);
  assert.equal(C.photoUpgrade({ width: { max: 8064 }, height: { max: 6048 } }, null, '3:4', 1920).height.ideal, 1920);
  assert.equal(C.photoUpgrade(back, { width: 1080, height: 1920 }, '16:9'), null);
  // Webcam pequena: não mexe.
  assert.equal(C.photoUpgrade({ width: { max: 1280 }, height: { max: 720 } }, { width: 720, height: 960 }, '3:4'), null);
});

test('visor lento depois de subir: abaixo de 15 imagens/s volta a 1440×1920; com pouca amostra não decide', () => {
  assert.equal(C.upgradeTooSlow(36, 1200), false); // 30 fps
  assert.equal(C.upgradeTooSlow(24, 1200), false); // 20 fps (Android com pouca luz): não é travar
  assert.equal(C.upgradeTooSlow(12, 1200), true); // 10 fps
  assert.equal(C.upgradeTooSlow(0, 1200), true); // parado
  assert.equal(C.upgradeTooSlow(2, 300), false);
  assert.equal(C.upgradeTooSlow(NaN, 1200), false);
  assert.deepEqual(C.PHOTO_SAFE, { width: { ideal: 1440 }, height: { ideal: 1920 }, aspectRatio: { ideal: 3 / 4 } });
});

test('teto da foto: o lado maior até 2880, a forma mantém-se e nunca se aumenta', () => {
  assert.deepEqual(C.fitLong(3000, 4000), { w: 2160, h: 2880, k: 0.72 });
  assert.deepEqual(C.fitLong(1440, 1800), { w: 1440, h: 1800, k: 1 });
  const s = C.fitLong(6120, 8160);
  assert.equal(s.h, 2880);
  assert.ok(Math.abs(s.w / s.h - 0.75) < 0.001);
  // O ImageCapture (Android) usa-o em vez dos 16 MP de antes (o JPEG passava dos 8 MB do servidor).
  assert.match(CAM, /const fit = fitLong\(r\.w, r\.h, PHOTO_MAX_LONG\);/);
  assert.doesNotMatch(CAM, /16_000_000/);
});

test('JPEG final: 92 %; se passar de 7 MB grava outra vez a 85 %', async () => {
  const asked = [];
  const small = await C.encodePhoto(async (q) => { asked.push(q); return { size: 2_500_000, q }; });
  assert.deepEqual(asked, [0.92]);
  assert.equal(small.q, 0.92);
  asked.length = 0;
  const big = await C.encodePhoto(async (q) => { asked.push(q); return { size: q > 0.9 ? 7_900_000 : 5_000_000, q }; });
  assert.deepEqual(asked, [0.92, 0.85]);
  assert.equal(big.q, 0.85);
  assert.equal(await C.encodePhoto(async () => null), null);
});

test('a foto que segue (Usar e Guardar) sai do original, nunca da cópia de 1600 px da pré-visualização', () => {
  const body = (name) => {
    const i = CAM.indexOf(`async function ${name}()`);
    assert.ok(i > 0, name);
    return CAM.slice(i, CAM.indexOf('\n  }\n', i));
  };
  for (const name of ['acceptReview', 'saveReview']) {
    const b = body(name);
    assert.match(b, /const src = reviewSrc\.current;/, name);
    assert.doesNotMatch(b, /previewSrc\.current \?\?|previewSrc\.current\)/, name);
    assert.match(b, /photoJpeg\(renderEdit\(src, /, name);
  }
  // A pré-visualização é a única que usa a cópia pequena.
  assert.match(CAM, /const src = previewSrc\.current \?\? reviewSrc\.current;\s*if \(!src\) \{ pending\.current = null; return; \}/);
  assert.match(CAM, /const photoJpeg = \(c: HTMLCanvasElement\) => encodePhoto\(/);
});

test('fotos juntas (layout): 1440×1800 e reduzidas com qualidade alta', () => {
  assert.match(CAM, /export const LAYOUT_W = 1440, LAYOUT_H = 1800;/);
  assert.match(CAM, /const W = LAYOUT_W, H = LAYOUT_H;/);
  assert.doesNotMatch(CAM, /const W = 1080, H = 1350/);
  const cover = CAM.slice(CAM.indexOf('function cover('), CAM.indexOf('\n}\n', CAM.indexOf('function cover(')));
  assert.match(cover, /imageSmoothingQuality = 'high'/);
});

test('ao subir a resolução confere-se o visor, e ao sair a câmara volta ao pedido normal (o Zás usa-a a seguir)', () => {
  assert.match(CAM, /if \(up && t\) \{ await t\.applyConstraints\(up\); upgraded = true; \}/);
  assert.match(CAM, /if \(upgraded && t && v\) void checkSmooth\(seq, t, v\);/);
  assert.match(CAM, /if \(upgradeTooSlow\(n\.frames, n\.ms\)\) await t\.applyConstraints\(PHOTO_SAFE\)/);
  assert.match(CAM, /if \(up && up\.readyState === 'live'\) up\.applyConstraints\(PHOTO_BASE\)/);
  assert.deepEqual(C.PHOTO_BASE, { width: { ideal: 1080 }, height: { ideal: 1440 }, aspectRatio: { ideal: 3 / 4 } });
  // É o mesmo pedido da sessão partilhada da câmara.
  assert.match(read('components', 'zas', 'cameraSession.ts'), /width: \{ ideal: 1080 \}, height: \{ ideal: 1440 \}, aspectRatio: \{ ideal: 3 \/ 4 \}/);
});

test('largura pedida ao servidor: num iPhone (DPR 3) o feed pede 1080 e o ecrã inteiro 1600; sem densidade, menos', () => {
  assert.deepEqual([...P.SERVED_WIDTHS], [160, 256, 480, 720, 1080, 1600]);
  assert.equal(P.servedWidth(398, 3), 1080); // cartão do feed num iPhone Pro Max (1194 px reais)
  assert.equal(P.servedWidth(366, 3), 1080); // iPhone de 390 pontos
  assert.equal(P.servedWidth(430, 3), 1600); // mimo em ecrã inteiro (1290 px)
  assert.equal(P.servedWidth(380, 2.625), 1080); // Android comum
  assert.equal(P.servedWidth(470, 2), 1080); // computador com ecrã retina
  assert.equal(P.servedWidth(470, 1), 480);
  assert.equal(P.servedWidth(398, 4), P.servedWidth(398, 3)); // a densidade conta até 3
  assert.equal(P.servedWidth(2000, 3), 1600);
  assert.equal(P.servedWidth(NaN, NaN), 480);
});

test('o feed e os mimos pedem a largura pela densidade do ecrã (antes 720 e 1080 fixos)', () => {
  const card = read('components', 'PostCard.tsx');
  assert.match(card, /sized\(m\.url, servedWidth\(width, PixelRatio\.get\(\)\)\)/);
  assert.doesNotMatch(card, /sized\(m\.url, 720\)/);
  const story = read('app', 'stories', '[username].tsx');
  // O que se pré-carrega tem de ser o mesmo endereço do que se mostra (senão descarregava duas vezes).
  assert.equal((story.match(/\.mediaUrl, servedWidth\(width, PixelRatio\.get\(\)\)\)/g) ?? []).length, 3);
  assert.doesNotMatch(story, /\.mediaUrl, 1080\)/);
  // O visor de fotos já pedia a maior.
  assert.match(read('components', 'PhotoViewer.tsx'), /sized\(photo\.url, 1600\)/);
});

test('editor do telemóvel: ao alto grava até 1440 de largura (era 1080); deitada até 1920; nunca aumenta', () => {
  assert.equal(P.editorOutWidth(1440, 0.8), 1440); // publicação 4:5 → 1440×1800
  assert.equal(P.editorOutWidth(1440, 9 / 16), 1440); // mimo → 1440×2560
  assert.equal(P.editorOutWidth(2560, 0.8), 1440);
  assert.equal(P.editorOutWidth(900, 0.8), 900);
  assert.equal(P.editorOutWidth(2560, 1), 1920);
  assert.equal(P.editorOutWidth(2560, 1.91), 1920);
  assert.match(read('components', 'PhotoEditor.tsx'), /const outW = editorOutWidth\(cr\.cw, cr\.a\);/);
  // E chega ao servidor sem ser reduzida outra vez (a fila de publicação só reduz acima de 2048).
  assert.match(read('lib', 'publishQueue.ts'), /shrinkPhoto\(a\.uri, POST_MAX_SIDE, POST_MAX_SIDE\)/);
  assert.match(read('lib', 'cropToRatio.ts'), /export const POST_MAX_SIDE = 2048;/);
});

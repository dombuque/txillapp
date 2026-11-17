// Estúdio: «Encher» / «Inteiro» (lib/studio/fit.ts), o contrato `clips[i].fit` partilhado com o servidor.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import './fixtures/alias.mjs'; // o alias @/ (os módulos usam t() de @/lib/i18n)
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const F = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'fit.ts')).href);
const P = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'project.ts')).href);
const R = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'composeRequest.ts')).href);

test('automático: enche até 0,8 de largura/altura, inteiro acima', () => {
  assert.equal(F.FIT_AUTO_MAX_ASPECT, 0.8);
  assert.equal(F.autoFit(1080, 1920), 'cover'); // 9:16
  assert.equal(F.autoFit(1080, 1350), 'cover'); // 4:5 = 0,8 (no limite enche)
  assert.equal(F.autoFit(1080, 1349), 'blur'); // um pouco mais largo
  assert.equal(F.autoFit(1080, 1080), 'blur'); // quadrado
  assert.equal(F.autoFit(1920, 1080), 'blur'); // 16:9
  assert.equal(F.autoFit(4000, 3000), 'blur'); // foto 4:3
});

test('a rotação conta: um vídeo do telemóvel ao alto vem 1920×1080 com 90°', () => {
  assert.equal(F.autoFit(1920, 1080, 90), 'cover');
  assert.equal(F.autoFit(1920, 1080, -90), 'cover');
  assert.equal(F.autoFit(1920, 1080, 270), 'cover');
  assert.equal(F.autoFit(1920, 1080, 180), 'blur');
  assert.deepEqual(F.displaySize(1920, 1080, 90), { w: 1080, h: 1920 });
});

test('sem medidas (a carregar) enche, como antes', () => {
  assert.equal(F.autoFit(0, 0), 'cover');
  assert.equal(F.autoFit(NaN, 100), 'cover');
  assert.equal(F.autoFit(100, Infinity), 'cover');
});

test('a escolha da pessoa ganha; o enquadramento da Montagem mágica enche no automático; a moldura não muda', () => {
  const land = [1920, 1080];
  assert.equal(F.clipFit({ video: true }, ...land), 'blur');
  assert.equal(F.clipFit({ video: true, fit: 'cover' }, ...land), 'cover');
  assert.equal(F.clipFit({ video: false, fit: 'blur' }, 1080, 1920), 'blur');
  const focus = { focus: { x: 0.3, y: 0.4, from: 1, to: 1.1 } };
  assert.equal(F.clipFit({ video: false, fx: focus }, ...land), 'cover', 'foto com enquadramento: fica como estava');
  assert.equal(F.clipFit({ video: false, fx: focus, fit: 'blur' }, ...land), 'blur', 'a não ser que a pessoa escolha «Inteiro»');
  assert.equal(F.clipFit({ video: false, fx: { moldura: { pattern: 'losangos', palette: 'coral', seed: 1 } }, fit: 'blur' }, ...land), 'cover');
  assert.equal(F.clipFit({ video: true, fit: 'outra' }, ...land), 'blur', 'um valor estranho conta como automático');
});

test('as contas do desenho: contido, a cobrir, o desfoque e o zoom da frente', () => {
  assert.deepEqual(F.containRect(1920, 1080, 1080, 1920), { x: 0, y: (1920 - 607.5) / 2, w: 1080, h: 607.5 });
  const c = F.coverSource(1920, 1080, 1080, 1920);
  assert.equal(c.h, 1080);
  assert.ok(Math.abs(c.w - 607.5) < 1e-9);
  assert.ok(Math.abs(c.x - (1920 - 607.5) / 2) < 1e-9);
  assert.equal(F.blurSigma(1080), 40);
  assert.equal(F.blurSigma(540), 20);
  assert.equal(F.BLUR_BRIGHTNESS, 0.7);
  assert.deepEqual(F.BLUR_DIM_MATRIX.slice(0, 5), [0.7, 0, 0, 0, 0]);
  assert.equal(F.BLUR_DIM_MATRIX[18], 1, 'o alfa fica');
  // Ken Burns no «Inteiro»: a caixa fica, a foto cresce lá dentro ao centro.
  const z = F.zoomSource(1000, 500, 1.25);
  assert.deepEqual(z, { x: 100, y: 50, w: 800, h: 400 });
  assert.deepEqual(F.zoomSource(1000, 500, 1), { x: 0, y: 0, w: 1000, h: 500 });
});

test('withFit: escolher e voltar ao automático', () => {
  const c = { key: 'a' };
  const b = F.withFit(c, 'blur');
  assert.equal(b.fit, 'blur');
  assert.equal(F.withFit(b, 'blur'), b, 'a mesma escolha não cria outro objeto');
  assert.ok(!('fit' in F.withFit(b, null)));
  assert.equal(F.withFit(c, null), c);
  assert.equal(F.fitLabel('blur'), 'Inteiro');
  assert.equal(F.fitLabel('cover'), 'Encher');
});

test('o projeto guarda a escolha (rascunhos) e também o som de cada vídeo', () => {
  const [v, p] = P.normalizeClips([
    { key: 'v', uri: 'file:///v.mp4', video: true, length: 5, trim: { start: 0, end: 5 }, fit: 'blur', sound: false, volume: 0.4 },
    { key: 'p', uri: 'file:///p.jpg', video: false, fit: 'nada', sound: false },
  ]);
  assert.equal(v.fit, 'blur');
  assert.equal(v.sound, false);
  assert.equal(v.volume, 0.4);
  assert.ok(!('fit' in p), 'um valor estranho não fica');
  assert.ok(!('sound' in p), 'as fotos não têm som');
  // Substituir o ficheiro mantém a escolha.
  const rep = P.replaceMedia([v], 'v', { uri: 'file:///w.mp4', video: true, mime: 'video/mp4', durationMs: 4000 });
  assert.equal(rep[0].fit, 'blur');
});

test('o pedido de montagem leva `fit` só quando a pessoa escolheu (sem ele, o servidor faz o automático)', () => {
  const clips = P.normalizeClips([
    { key: 'a', media: 'a', uri: 'file:///a.mp4', video: true, length: 4, trim: { start: 0, end: 4 }, fit: 'blur' },
    { key: 'b', media: 'b', uri: 'file:///b.jpg', video: false, seconds: 3, fit: 'cover' },
    { key: 'c', media: 'c', uri: 'file:///c.jpg', video: false, seconds: 3 },
  ]);
  const req = R.buildComposeRequest({ clips, mediaIds: { a: 'A', b: 'B', c: 'C' }, overlays: [], mix: { musicStartMs: 0, fadeIn: 0, fadeOut: 0, ducking: true, voice: null, origFx: 'normal', sfx: [], sfxVolume: 1 }, origVol: 1, musicVol: 1, rhythm: false, total: 10, coverAt: 0.5 });
  assert.equal(req.clips[0].fit, 'blur');
  assert.equal(req.clips[1].fit, 'cover');
  assert.ok(!('fit' in req.clips[2]));
  // Um servidor antigo não conhece o campo: o pedido compatível tira-o (e avisa).
  const compat = R.compatRequest(req);
  assert.ok(compat.request.clips.every((c) => !('fit' in c)));
  assert.ok(compat.changed.includes('o «Encher»/«Inteiro» de cada clipe'));
});

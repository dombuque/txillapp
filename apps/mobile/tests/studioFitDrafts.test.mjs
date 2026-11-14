// Estúdio: os rascunhos de antes do «Encher»/«Inteiro» (sem `fit`) continuam a abrir e ficam no automático.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const F = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'fit.ts')).href);
const P = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'project.ts')).href);
const D = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'drafts.ts')).href);
const R = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'composeRequest.ts')).href);

/** Um rascunho como o guardava a versão anterior (v 1, os clipes sem `fit`, `sound` nem `volume`). */
const oldDraft = {
  id: 'st-antigo', v: 1, savedAt: 1_700_000_000_000,
  clips: [
    { key: 'k1', media: 'm1', video: false, mime: 'image/jpeg', seconds: 3, beats: 2 },
    { key: 'k2', media: 'm2', video: true, mime: 'video/mp4', durationMs: 6000, length: 6, speed: 1, trim: { start: 0.5, end: 4.5 } },
    { key: 'k3', media: 'm3', video: false, mime: 'image/jpeg', seconds: 2, fx: { focus: { x: 0.4, y: 0.5, from: 1, to: 1.07 } } },
  ],
  media: [{ key: 'm1', mime: 'image/jpeg' }, { key: 'm2', mime: 'video/mp4' }, { key: 'm3', mime: 'image/jpeg' }],
  settings: { look: 0 },
};

test('um rascunho antigo sem `fit` abre com todos os clipes, sem campos novos inventados', () => {
  const urls = new Map([['m1', 'blob:1'], ['m2', 'blob:2'], ['m3', 'blob:3']]);
  const clips = P.normalizeClips(D.clipsFromDraft(oldDraft, urls));
  assert.equal(clips.length, 3);
  assert.deepEqual(clips.map((c) => c.key), ['k1', 'k2', 'k3']);
  for (const c of clips) {
    assert.ok(!('fit' in c), 'sem escolha guardada: automático');
    assert.ok(!('sound' in c) && !('volume' in c));
  }
  assert.deepEqual(clips[1].trim, { start: 0.5, end: 4.5 });
  assert.deepEqual(clips[2].fx, oldDraft.clips[2].fx);
});

test('os clipes de um rascunho antigo seguem o automático (deitado inteiro, de pé a encher, a foto com enquadramento a encher)', () => {
  const clips = P.normalizeClips(D.clipsFromDraft(oldDraft, new Map([['m1', 'blob:1'], ['m2', 'blob:2'], ['m3', 'blob:3']])));
  assert.equal(F.clipFit(clips[0], 4032, 3024), 'blur', 'foto 4:3 deitada');
  assert.equal(F.clipFit(clips[0], 3024, 4032), 'cover', 'foto 3:4 de pé');
  assert.equal(F.clipFit(clips[1], 1920, 1080, 90), 'cover', 'vídeo do telemóvel de pé (rodado 90°)');
  assert.equal(F.clipFit(clips[1], 1920, 1080), 'blur', 'vídeo deitado');
  assert.equal(F.clipFit(clips[2], 4032, 3024), 'cover', 'Montagem mágica: a foto com enquadramento continua a encher');
});

test('o pedido de montagem de um rascunho antigo não leva `fit` (o servidor decide) e guardar outra vez mantém a escolha nova', () => {
  const clips = P.normalizeClips(D.clipsFromDraft(oldDraft, new Map([['m1', 'blob:1'], ['m2', 'blob:2'], ['m3', 'blob:3']])));
  const req = R.buildComposeRequest({ clips, mediaIds: { m1: 'A', m2: 'B', m3: 'C' }, overlays: [], mix: { musicStartMs: 0, fadeIn: 0, fadeOut: 0, ducking: true, voice: null, origFx: 'normal', sfx: [], sfxVolume: 1 }, origVol: 1, musicVol: 1, rhythm: false, total: 9, coverAt: 0.5 });
  assert.equal(req.clips.length, 3);
  assert.ok(req.clips.every((c) => !('fit' in c)));
  // A pessoa escolhe «Inteiro» no clipe 2 e o rascunho volta a guardar-se: abre com a escolha.
  const edited = clips.map((c, i) => (i === 1 ? F.withFit(c, 'blur') : c));
  const { draft, uris } = D.draftFromProject({ id: oldDraft.id, clips: edited, settings: oldDraft.settings, now: 1 });
  const back = P.normalizeClips(D.clipsFromDraft(draft, uris));
  assert.equal(back[1].fit, 'blur');
  assert.ok(!('fit' in back[0]) && !('fit' in back[2]));
});

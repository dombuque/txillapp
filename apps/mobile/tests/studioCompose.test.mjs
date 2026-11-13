// Estúdio nativo: o projeto → o pedido de montagem no servidor (POST /tchekas/compose, docs/montagem.md 2, 4-A e 4-B).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (x) => import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', x)).href);
const c = await mod('composeRequest.ts');
const p = await mod('project.ts');
const a = await mod('audioMix.ts');
const fx = await mod('effects.ts');

const ids = () => { let n = 0; return () => `k${++n}`; };
function project() {
  const g = ids();
  const v = p.makeClip({ uri: 'file:///v1.mp4', video: true, mime: 'video/mp4', durationMs: 8000 }, g);
  const f = p.makeClip({ uri: 'file:///f1.jpg', video: false, mime: 'image/jpeg' }, g);
  const v2 = p.makeClip({ uri: 'file:///v2.mp4', video: true, mime: 'video/mp4', durationMs: 4000, speed: 2 }, g);
  return [
    { ...v, trim: { start: 1.25, end: 5.5 }, sound: false, fx: { filter: { id: 'matapa', amount: 0.8 }, adjust: { contrast: 0.2 }, ramp: 'heroi' } },
    { ...f, seconds: 2.5, beats: 3, fx: { transition: { type: 'zoom', dur: 0.6 }, focus: { x: 0.4, y: 0.3, from: 1, to: 1.2 }, ramp: 'bala', reverse: true } },
    { ...v2, volume: 0.4, fx: { reverse: true, freeze: { from: 'x', at: 1 } } },
  ];
}
const mediaIds = { k1: 'm-1', k2: 'm-2', k3: 'm-3' };
const mix = () => ({ ...a.defaultMix(), musicStartMs: 12345, fadeIn: 1.5, fadeOut: 4, ducking: false, origFx: 'eco', sfx: [{ key: 's2', id: 'pop', at: 3 }, { key: 's1', id: 'whoosh', at: 0.5 }, { key: 's3', id: 'boom', at: 99 }], sfxVolume: 0.7, voice: { id: 'v', at: 2, duration: 4, volume: 0.9, fx: 'robo', regions: [], peaks: [] } });
const base = (o = {}) => ({ clips: project(), mediaIds, overlays: [], mix: mix(), voiceMediaId: 'voz-1', music: { id: 't1', title: 'Faixa', url: 'https://x/a.mp3' }, origVol: 0.4, musicVol: 0.75, rhythm: true, bpm: 118, total: 14, coverAt: 3.2, ...o });

test('os clipes: chave, ficheiro, corte, velocidade, duração das fotos, batidas e som de cada vídeo', () => {
  const r = c.buildComposeRequest(base());
  assert.equal(r.clips.length, 3);
  const [v, f, v2] = r.clips;
  assert.deepEqual({ id: v.id, mediaId: v.mediaId, kind: v.kind, trimStartMs: v.trimStartMs, trimEndMs: v.trimEndMs, sound: v.sound }, { id: 'k1', mediaId: 'm-1', kind: 'video', trimStartMs: 1250, trimEndMs: 5500, sound: false });
  assert.equal(v.speed, undefined, 'a 1× não vai');
  assert.equal(v2.speed, 2);
  assert.equal(v2.volume, 0.4);
  assert.equal(f.kind, 'photo');
  assert.equal(f.durationMs, 2500);
  assert.equal(f.beats, 4, '3 batidas não existem no servidor: arredonda para 4');
});

test('os efeitos: filtro e ajustes, a transição escrita a partir do 2.º, rampa e inverso só nos vídeos, enquadramento só nas fotos', () => {
  const r = c.buildComposeRequest(base());
  const [v, f, v2] = r.clips;
  assert.deepEqual(v.fx, { filter: { id: 'matapa', amount: 0.8 }, adjust: { contrast: 0.2 }, ramp: 'heroi' });
  assert.equal(v.fx.transition, undefined, 'o primeiro não tem entrada');
  assert.deepEqual(f.fx.transition, { type: 'zoom', dur: 0.6 });
  assert.equal(f.fx.ramp, undefined);
  assert.equal(f.fx.reverse, undefined);
  assert.deepEqual(f.fx.focus, { x: 0.4, y: 0.3, from: 1, to: 1.2 });
  assert.deepEqual(v2.fx.transition, { type: 'fundido', dur: 0.5 }, 'sem transição escolhida vai a de sempre (modo estúdio)');
  assert.equal(v2.fx.reverse, true);
  assert.equal(v2.fx.freeze, undefined, 'congelar é só nas fotos');
  // Todos os ids vêm do contrato.
  for (const cl of r.clips) if (cl.fx?.transition) assert.ok(fx.TRANSITIONS.some((t) => t.id === cl.fx.transition.type));
});

test('um frame congelado aponta para um clipe desta tcheka', () => {
  const clips = project();
  clips[1] = { ...clips[1], fx: { freeze: { from: 'k1', at: 2.5 } } };
  let r = c.buildComposeRequest(base({ clips }));
  assert.deepEqual(r.clips[1].fx.freeze, { from: 'k1', at: 2.5 });
  clips[1] = { ...clips[1], fx: { freeze: { from: 'sumiu', at: 2.5 } } };
  r = c.buildComposeRequest(base({ clips }));
  assert.equal(r.clips[1].fx.freeze.from, 'k2');
});

test('o som: música, trecho, fades (até 3 s), voz-off, ducking, efeito original, efeitos sonoros por ordem e dentro da tcheka, batidas', () => {
  const r = c.buildComposeRequest(base());
  assert.deepEqual(r.sound, { kind: 'music', music: { id: 't1', title: 'Faixa', url: 'https://x/a.mp3' } });
  assert.equal(r.originalVolume, 0.4);
  assert.equal(r.musicVolume, 0.75);
  assert.equal(r.musicStartMs, 12345);
  assert.equal(r.musicFadeInMs, 1500);
  assert.equal(r.musicFadeOutMs, 3000);
  assert.deepEqual(r.voiceOver, { mediaId: 'voz-1', startMs: 2000, volume: 0.9, effect: 'robo' });
  assert.equal(r.ducking, false);
  assert.equal(r.originalEffect, 'eco');
  assert.deepEqual(r.soundEffects, [{ id: 'whoosh', atMs: 500 }, { id: 'pop', atMs: 3000 }]);
  assert.equal(r.soundEffectsVolume, 0.7);
  assert.deepEqual(r.beats, { mode: 'auto', bpm: 118 });
  assert.equal(r.coverMs, 3200);
});

test('«Usar este som» ganha à música; sem som não há trecho nem batidas; sem a voz enviada, a voz-off não vai', () => {
  let r = c.buildComposeRequest(base({ soundId: 'som-1' }));
  assert.deepEqual(r.sound, { kind: 'sound', soundId: 'som-1' });
  r = c.buildComposeRequest(base({ music: null, voiceMediaId: null }));
  assert.equal(r.sound, undefined);
  assert.equal(r.musicStartMs, undefined);
  assert.equal(r.beats, undefined);
  assert.equal(r.clips[1].beats, undefined);
  assert.equal(r.voiceOver, undefined);
});

test('as camadas: as que entram depois do fim saem, as que passam do fim cortam-se; a capa nunca passa do fim; o dueto', () => {
  const t1 = fx.newText(1, 14, 'Olá');
  const t2 = { ...fx.newText(1, 14, 'Tarde'), start: 13.98, end: 16 };
  const t3 = { ...fx.newText(1, 14, 'Longo'), start: 10, end: 20 };
  const r = c.buildComposeRequest(base({ overlays: [t1, t2, t3], coverAt: 30, duetPostId: '00000000-0000-0000-0000-000000000001', pano: { pattern: 'sol', palette: 'neon', seed: 4 } }));
  assert.deepEqual(r.pano, { pattern: 'sol', palette: 'neon', seed: 4 });
  assert.equal(c.compatRequest(r).request.pano, undefined);
  assert.deepEqual(r.overlays.map((o) => o.text), ['Olá', 'Longo']);
  assert.equal(r.overlays[1].end, 14);
  assert.equal(r.coverMs, 13900);
  assert.deepEqual(r.duet, { postId: '00000000-0000-0000-0000-000000000001', layout: 'side' });
});

test('os ficheiros que faltam enviar e o que impede a montagem', () => {
  const clips = project();
  assert.deepEqual(c.missingMedia(clips, { k1: 'm' }), ['k2', 'k3']);
  assert.equal(c.composeBlocker(clips), null);
  assert.match(c.composeBlocker([{ ...clips[0], speed: 1.5 }]), /0,5×, 1×, 2× ou 3×/);
  assert.match(c.composeBlocker(Array.from({ length: 31 }, () => clips[1])), /No máximo 30/);
  assert.match(c.composeBlocker([{ ...clips[1], seconds: 12 }]), /no máximo 10 s/);
});

test('para um servidor mais antigo: sem panos, sem enquadramento, sem som por clipe (todos calados = som original a 0)', () => {
  const clips = project();
  clips[1] = { ...clips[1], fx: { transition: { type: 'capulana-rasgar', dur: 0.7, pano: { pattern: 'sol', palette: 'coral', seed: 3 } }, moldura: { pattern: 'sol', palette: 'coral', seed: 3 } } };
  clips[2] = { ...clips[2], sound: false };
  const pano = { pattern: 'losangos', palette: 'neon', seed: 1 };
  const ovs = [{ ...fx.newText(0, 14, 'Faixa'), bg: 'pano', pano }, fx.newSticker({ type: 'capulana', shape: 'estrela', pano }, 0, 14), fx.newSticker({ type: 'emoji', emoji: '🔥' }, 0, 14)];
  const full = c.buildComposeRequest(base({ clips, overlays: ovs }));
  const { request, changed } = c.compatRequest(full);
  assert.deepEqual(request.clips[1].fx, { transition: { type: 'zoom', dur: 0.7 } });
  assert.ok(request.clips.every((x) => x.sound === undefined && x.volume === undefined));
  assert.equal(request.originalVolume, 0);
  assert.deepEqual(request.overlays.map((o) => o.kind), ['text', 'sticker']);
  assert.equal(request.overlays[0].bg, 'cheio');
  assert.equal(request.overlays[0].pano, undefined);
  assert.ok(changed.includes('as transições de pano') && changed.includes('o som de cada vídeo'));
  assert.equal(c.requestSignature(full), c.requestSignature(JSON.parse(JSON.stringify(full))));
});

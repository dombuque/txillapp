// Estúdio das tchekas: os encaixes entre a linha do tempo (projeto, desfazer, rascunhos), os efeitos e o som.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (...x) => import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', ...x)).href);
const d = await mod('drafts.ts');
const h = await mod('history.ts');
const p = await mod('project.ts');
const u = await mod('urls.ts');
const fx = await mod('effects.ts');
const read = (...x) => readFileSync(path.join(ROOT, 'src', ...x), 'utf8').replace(/\r\n/g, '\n');
const studio = read('components', 'TchekaStudio.tsx');

test('o rascunho guarda também os outros ficheiros do projeto (a voz-off) e devolve-os ao abrir', async () => {
  const ids = (() => { let n = 0; return () => `k${++n}`; })();
  const clips = [p.makeClip({ uri: 'blob:a', video: false, mime: 'image/jpeg' }, ids)];
  const { draft, uris } = d.draftFromProject({ id: 'r1', clips, extra: [{ key: 'v1', uri: 'blob:voz', mime: 'audio/webm' }] });
  assert.deepEqual(draft.media.map((m) => m.key), [clips[0].media, 'v1']);
  assert.equal(uris.get('v1'), 'blob:voz');
  const s = d.createDraftStore(d.memoryBackend(), { readMedia: async (x) => `B(${x})`, toUrl: (v) => `url:${v}` });
  await s.save({ id: 'r1', clips, extra: [{ key: 'v1', uri: 'blob:voz', mime: 'audio/webm' }] });
  const back = await s.load('r1');
  assert.equal(back.media.v1, 'url:B(blob:voz)');
  assert.equal(back.clips.length, 1, 'a voz-off não vira um clipe');
});

test('os URLs em uso contam os clipes e os outros ficheiros de cada passo do projeto', () => {
  const inUse = u.urlsInUse([[{ uri: 'blob:1' }], { clips: [{ uri: 'blob:2' }], uris: ['blob:voz'] }]);
  assert.deepEqual([...inUse].sort(), ['blob:1', 'blob:2', 'blob:voz']);
});

test('os acertos do próprio estúdio trocam o estado de agora sem perder o refazer', () => {
  let x = h.initHistory(1);
  x = h.pushHistory(x, 2);
  x = h.undo(x);
  const y = h.replacePresent(x, 10);
  assert.equal(y.present, 10);
  assert.deepEqual(y.future, [2], 'o refazer fica');
  assert.equal(h.replacePresent(y, 10), y, 'sem mudança, o mesmo histórico');
});

test('cortar pela ponta com rampa: o ficheiro anda à taxa da rampa (rate), não só à velocidade', () => {
  const c = { ...p.makeClip({ uri: 'blob:v', video: true, mime: 'video/mp4', durationMs: 20000 }, () => 'k'), trim: { start: 0, end: 10 }, fx: { ramp: 'bala' } };
  const dur = fx.fxSeconds(10, 1, c.fx);
  const rate = 10 / dur;
  const r = p.trimEdge([c], 'k', 'end', -1, { durations: [dur], rate });
  assert.ok(Math.abs(r.clips[0].trim.end - (10 - rate)) < 0.01, 'um segundo da sequência tira `rate` segundos ao ficheiro');
});

test('ligação: o projeto leva os clipes, as camadas e o som; o desfazer abrange tudo', () => {
  assert.match(studio, /interface Project \{ clips: Item\[\]; overlays: Overlay\[\]; mix: StudioMix; origVol: number; musicVol: number; applied: string \| null; uris: string\[\] \}/);
  assert.match(studio, /useStudioAudio\(\{[^\n]*mix, setMix \}\)/, 'o som do painel é o do projeto');
  assert.match(studio, /if \(auto\) fixPresent\(step\); else commit\(step, \{ coalesce: 'mix' \}\);/, 'o trecho sugerido não é um passo');
  assert.match(studio, /settings: \{ \.\.\.snap\.settings \}/);
  assert.match(studio, /mix: mix\.voice \? \{ \.\.\.mix, voice: \{ \.\.\.mix\.voice, uri: undefined \} \} : mix/, 'o rascunho leva o som sem o URL da sessão');
  assert.match(studio, /extra: voiceFile/, 'e o ficheiro da voz-off à parte');
  assert.match(studio, /onGesture=\{\(ph\) => \{ ovGesture\.current = /, 'arrastar um texto no palco é um passo');
});

test('ligação: «Ajustar ao ritmo» e os moldes passam pelas funções do projeto, num passo só', () => {
  const fit = studio.slice(studio.indexOf('function rhythmFit('), studio.indexOf('const audioCtl'));
  assert.match(fit, /trimEdge\(l, c\.key, edge, delta/);
  assert.match(fit, /setPhoto\(l, it\.key, \{ beats: b \}\)/);
  assert.doesNotMatch(fit, /setItems\(/, 'tudo num commit (clipes, transições e som)');
});

test('ligação: as faixas do som (voz-off e efeitos sonoros) e das camadas na linha do tempo', () => {
  assert.match(studio, /kind: 'voice', label: 'Voz-off'/);
  assert.match(studio, /kind: 'sfx', [^\n]*point: true/);
  const tl = read('components', 'studio', 'Timeline.tsx');
  assert.match(tl, /data-tl="layer"/);
  assert.match(tl, /data-tl=\{side === 'start' \? 'l-start' : 'l-end'\}/);
});

test('o som de cada vídeo: ligado por omissão, desligado não conta para o som obrigatório', () => {
  assert.match(studio, /const soundOn = \(it: Item\) => it\.sound !== false && \(it\.volume \?\? 1\) > 0;/);
  assert.match(studio, /const origVol = num\(init\.origVol, initMusic\?\.kind === 'sound' \? 0 : 1\);/, 'com música, o som dos vídeos fica inteiro');
  assert.match(studio, /e\.clipGain\.set\(el, gain\)/, 'cada vídeo tem o volume dele');
});

test('telemóvel: o estúdio cobre o ecrã (100dvh), a folha dos painéis tem altura fixa e fecha no separador escolhido', () => {
  assert.match(studio, /position: 'fixed', left: 0, top: 0, right: 0, height: '100dvh'/);
  assert.match(studio, /\{ height: sheetOpen \? sheetH : 0 \}/);
  assert.match(studio, /if \(id === tab\) setSheetOpen\(\(o\) => !o\)/);
  assert.match(studio, /compact=\{!wide\}/, 'a linha do tempo compacta no telemóvel');
  assert.match(studio, /tabBtn: \{ paddingHorizontal: 8, minHeight: 44,/);
});

test('o som do vídeo na barra de ações do clipe (ligado/calado e volume)', () => {
  const actions = read('components', 'studio', 'TimelineActions.tsx');
  assert.match(actions, /Som do vídeo: ligado/);
  assert.match(actions, /aria-label="Volume do som do vídeo"/);
  assert.match(studio, /onSound=\{\(v\) => \{ if \(cur\) setClipSound\(cur\.key, v\); \}\}/);
});

test('reprodução com fotos e vídeos: sem seek a mais no ponto de corte, à espera do vídeo, atraso apanhado sem saltos', () => {
  const run = studio.slice(studio.indexOf('async function run('), studio.indexOf('async function loop('));
  assert.match(run, /const cue = \(v: HTMLVideoElement, at: number\) => \{ if \(v\.seeking \|\| Math\.abs\(v\.currentTime - at\) > 0\.15\) v\.currentTime = at; \};/);
  assert.doesNotMatch(run, /v\.currentTime = srcAt\(s, tl\);/, 'já não faz sempre o seek ao entrar no vídeo');
  assert.match(run, /starting === active \|\| active\.seeking \|\| active\.readyState < 2/, 'espera pelo play() a sério');
  assert.match(run, /if \(rec\?\.state === 'recording'\) rec\.pause\(\);/, 'a gravação também espera');
  assert.match(run, /if \(Math\.abs\(drift\) > 0\.5\) active\.currentTime = srcAt\(s, tl\);/, 'só um atraso grande faz o seek');
  assert.match(studio, /recDelay\.delayTime\.value = REC_AV_DELAY_S;/, 'o som da gravação acerta com a imagem');
});

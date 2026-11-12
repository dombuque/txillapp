// O som do estúdio das tchekas: a onda e o trecho sugerido (energia e refrão), os fades, a voz (onde há fala) e o ducking,
// «Ajustar ao ritmo» (cortes nas batidas), os moldes, os efeitos sonoros gerados por código, o reverb do Estádio, o WAV,
// a regra da voz-off como som e a ligação no estúdio (bloqueio durante a montagem, a gravação leva a mesma mistura).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mix = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'audioMix.ts')).href);
const dsp = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'audioDsp.ts')).href);
const rules = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'tchekaRules.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≈ ${b} (±${eps})`);

const RATE = 8000;
/** Uma «música» sintética: secções com amplitudes diferentes (ruído com semente, para ser sempre igual). */
function song(sections) {
  const rnd = dsp.seeded(42);
  const total = sections.reduce((n, s) => n + s.s, 0);
  const out = new Float32Array(Math.round(total * RATE));
  let i = 0;
  for (const s of sections) {
    for (let k = 0; k < Math.round(s.s * RATE); k++, i++) out[i] = (rnd() * 2 - 1) * s.a * (s.pulse ? (k % (RATE / 2) < RATE / 20 ? 1 : 0.4) : 1);
  }
  return out;
}

test('a onda: picos relativos ao mais alto, no número de bocados pedido', () => {
  const s = new Float32Array(1000);
  s[100] = 0.5; s[900] = -1;
  const p = mix.peaks(s, 10);
  assert.equal(p.length, 10);
  assert.equal(p[9], 1, 'o pico mais alto vale 1');
  assert.equal(p[1], 0.5);
  assert.equal(p[5], 0);
  assert.deepEqual(mix.peaks(new Float32Array(0), 4), [0, 0, 0, 0]);
});

test('energia: RMS em blocos de 0,1 s', () => {
  const e = mix.energyBlocks(song([{ s: 1, a: 0.1 }, { s: 1, a: 0.8 }]), RATE, 0.1);
  assert.equal(e.length, 20);
  assert.ok(e[15] > e[5] * 4, 'a parte forte tem muito mais energia');
});

test('trecho sugerido: o refrão (a entrada forte depois de uma parte calma), nunca a introdução', () => {
  // 20 s calmos, 15 s de refrão, 15 s médios, 10 s fortes mas curtos para a janela (e a meio de nada).
  const s = song([{ s: 20, a: 0.08 }, { s: 15, a: 0.7 }, { s: 15, a: 0.25 }, { s: 10, a: 0.8 }]);
  const sug = mix.suggestStart(s, RATE, 15, 'forte');
  near(sug.start, 20, 0.4, 'começa na entrada do refrão');
  assert.equal(sug.label, 'Refrão');
  // A subida: o refrão entra a 40% da janela.
  const up = mix.suggestStart(s, RATE, 10, 'subida');
  near(up.start, 16, 0.5, 'a subida começa antes do refrão');
  assert.equal(up.label, 'Antes do refrão');
  // A parte calma, sem escolher silêncio.
  const calm = mix.suggestStart(song([{ s: 5, a: 0 }, { s: 20, a: 0.6 }, { s: 15, a: 0.15 }, { s: 20, a: 0.6 }]), RATE, 10, 'calmo');
  assert.ok(calm.start >= 24 && calm.start <= 31, `parte calma (${calm.start})`);
  // Música mais curta do que a tcheka (ou quase): começa no início.
  assert.deepEqual(mix.suggestStart(song([{ s: 12, a: 0.5 }]), RATE, 10), { start: 0, label: 'Início' });
});

test('fades: rampas lineares de 0 a 3 s que se multiplicam (como o afade do ffmpeg)', () => {
  assert.equal(dsp.fadeGain(0, 10, 2, 0), 0);
  assert.equal(dsp.fadeGain(1, 10, 2, 0), 0.5);
  assert.equal(dsp.fadeGain(5, 10, 2, 3), 1);
  near(dsp.fadeGain(8.5, 10, 2, 3), 0.5, 1e-9, 'a meio do fade-out');
  assert.equal(dsp.fadeGain(10, 10, 2, 3), 0);
  assert.equal(dsp.fadeGain(3, 10, 0, 0), 1, 'sem fades');
  assert.equal(dsp.clampFade(5), 3, 'no máximo 3 s');
  assert.equal(dsp.clampFade(-1), 0);
  assert.deepEqual(dsp.fadePoints(10, 2, 3), [{ t: 0, g: 0 }, { t: 2, g: 1 }, { t: 7, g: 1 }, { t: 10, g: 0 }]);
  assert.deepEqual(dsp.fadePoints(10, 0, 0), [{ t: 0, g: 1 }, { t: 10, g: 1 }]);
  // Numa tcheka curta, os dois fades cruzam-se: a curva por pontos continua igual à conta.
  const pts = dsp.fadePoints(4, 3, 3);
  for (const t of [0.5, 1.5, 2, 3.2]) near(mix.curveAt(pts, t), dsp.fadeGain(t, 4, 3, 3), 0.17, `t=${t}`);
});

test('voz: onde há fala (com falhas curtas juntas) e o ducking da música por baixo', () => {
  const s = new Float32Array(RATE * 6);
  // Fala de 1 s a 2,5 s e de 2,7 s a 3,5 s (a falha de 0,2 s junta-se), e de 5 s a 5,5 s.
  for (const [a, b] of [[1, 2.5], [2.7, 3.5], [5, 5.5]]) for (let i = a * RATE; i < b * RATE; i++) s[i] = 0.4 * Math.sin(i * 0.3);
  const r = mix.voiceActivity(s, RATE);
  assert.equal(r.length, 2);
  near(r[0].start, 0.94, 0.05); near(r[0].end, 3.56, 0.05);
  near(r[1].start, 4.94, 0.05);
  const d = mix.duckPoints(r, 6, dsp.DUCK);
  near(mix.curveAt(d, 0.3), 1, 1e-9, 'antes de falar, a música está inteira');
  near(mix.curveAt(d, 2), dsp.DUCK.gain, 1e-9, 'a falar, baixa');
  near(mix.curveAt(d, 4.2), 1, 0.01, 'volta depois');
  near(mix.curveAt(d, 5.2), dsp.DUCK.gain, 1e-9);
  assert.ok(mix.curveAt(d, r[0].start - dsp.DUCK.attack / 2) < 1, 'começa a descer antes da voz');
  assert.deepEqual(mix.voiceActivity(new Float32Array(RATE), RATE), [], 'silêncio não é voz');
  // A voz-off conta só o que fica dentro da tcheka.
  assert.equal(mix.voiceSecondsIn({ at: 2, duration: 5 }, 6), 4);
  assert.equal(mix.voiceSecondsIn(null, 6), 0);
});

test('regras: uma voz-off com 3 s ou mais conta como o som (o servidor tem a mesma cópia)', () => {
  const photos = [1, 2, 3].map(() => ({ video: false, seconds: 3 }));
  assert.equal(rules.MIN_VOICE_S, 3);
  const ok = rules.checkTcheka({ clips: photos, music: false, voiceSeconds: 3 });
  assert.equal(ok.ok, true);
  assert.equal(ok.sound, 'voz');
  const short = rules.checkTcheka({ clips: photos, music: false, voiceSeconds: 1.2 });
  assert.equal(short.ok, false);
  assert.equal(short.problem, 'som');
  assert.equal(short.hint, 'Grava mais 2 s de voz-off ou escolhe uma música');
  assert.equal(rules.checkTcheka({ clips: photos, music: false }).hint, 'Escolhe uma música', 'sem voz-off, a dica de sempre');
  assert.equal(rules.checkTcheka({ clips: photos, music: true, voiceSeconds: 5 }).sound, 'music', 'com música, a música é o som');
  const api = readFileSync(path.join(ROOT, '..', 'api', 'src', 'compose', 'rules.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(api.split('// ---- cópia ----')[1].trim(), read('lib', 'tchekaRules.ts').trim(), 'a cópia do servidor é igual');
});

test('ajustar ao ritmo: fotos e vídeos acabam nas batidas (120 BPM, batida no 0)', () => {
  const grid = rules.beatGrid(120, 0, 90);
  const items = [
    { video: false, seconds: 1.1 },                                                        // ≈ 2 batidas
    { video: true, seconds: 2.3, trim: { start: 1, end: 3.3 }, length: 10, speed: 1 },     // acaba em 1 + 2,3 = 3,3 → 3,5 (mais perto, o ficheiro dá)
    { video: false, seconds: 2.2 },                                                        // ≈ 4 batidas
    { video: true, seconds: 1.4, trim: { start: 0, end: 2.8 }, length: 2.8, speed: 2 },    // não dá para a frente: corta para trás
  ];
  const fit = mix.fitToBeats(items, grid);
  assert.deepEqual(fit.beats, [2, null, 4, null]);
  // Monta como o estúdio monta (rhythmDurations com as batidas novas) e vê se todos os cortes caem na grelha.
  const trimmed = items.map((it, i) => (it.video ? { ...it, trim: fit.trims[i] ?? it.trim } : it));
  const durs = rules.rhythmDurations(trimmed.map((it, i) => ({ video: it.video, seconds: it.video ? rules.clipSeconds(it.trim, it.speed) : it.seconds, beats: fit.beats[i] ?? undefined })), grid);
  const cuts = rules.cutTimes([...durs, 1]);
  for (const c of cuts) near(Math.round(c / 0.5) * 0.5, c, 0.002, `o corte aos ${c} s cai numa batida`);
  assert.deepEqual(fit.trims[1], { start: 1, end: 3.5 }, 'o vídeo cresceu até à batida mais perto');
  assert.ok(fit.trims[3].end < 2.8, 'o vídeo a 2× sem mais ficheiro encolheu');
  // Com um máximo de batidas por vídeo (os moldes rápidos).
  const capped = mix.fitToBeats([{ video: true, seconds: 5, trim: { start: 0, end: 5 }, length: 5, speed: 1 }], grid, { maxBeats: 2 });
  assert.deepEqual(capped.trims[0], { start: 0, end: 1 });
  // Um vídeo curto demais para chegar à primeira batida fica como está.
  assert.deepEqual(mix.fitToBeats([{ video: true, seconds: 0.3, trim: { start: 0, end: 0.3 }, length: 0.3 }], grid).trims, [null]);
  // A batida no 0: mexer o início da música pela fase da grelha.
  assert.equal(mix.downbeatShift(0.2, 0.5), 0.2);
  assert.equal(mix.downbeatShift(0.01, 0.5), 0, 'quase no 0 já está bem');
  assert.equal(mix.downbeatShift(0.49, 0.5), 0, 'quase uma batida inteira: também');
});

test('moldes: 4 a 6, cada um com cortes, transição, trecho e fades válidos', () => {
  assert.ok(mix.TEMPLATES.length >= 4 && mix.TEMPLATES.length <= 6);
  const names = mix.TEMPLATES.map((t) => t.name);
  for (const n of ['Rápido', 'Cinemático', 'Amapiano', 'Marrabenta', 'Slow']) assert.ok(names.includes(n), n);
  for (const t of mix.TEMPLATES) {
    assert.ok([1, 2, 4].includes(t.photoBeats), `${t.id}: batidas por foto`);
    assert.ok([2, 3, 5].includes(t.photoSeconds), `${t.id}: segundos sem música`);
    assert.ok(['none', 'fade', 'slide'].includes(t.transition));
    assert.ok(['forte', 'subida', 'calmo', 'inicio'].includes(t.start));
    assert.ok(t.fadeIn >= 0 && t.fadeIn <= 3 && t.fadeOut >= 0 && t.fadeOut <= 3);
    assert.ok(t.pattern.length > 0 && t.desc.length > 10);
  }
  const marr = mix.TEMPLATES.find((t) => t.id === 'marrabenta');
  assert.deepEqual([0, 1, 2, 3].map((i) => mix.templatePhotoBeats(marr, i)), [1, 2, 1, 2], 'a Marrabenta alterna 1 e 2 batidas');
  const fast = mix.TEMPLATES.find((t) => t.id === 'rapido');
  const fit = mix.fitToBeats([{ video: false, seconds: 3 }, { video: false, seconds: 3 }, { video: false, seconds: 3 }], rules.beatGrid(120, 0, 60), { photoBeats: (i) => mix.templatePhotoBeats(fast, i) });
  assert.deepEqual(fit.beats, [1, 1, 1], 'no Rápido, uma batida por foto');
});

test('efeitos sonoros: 8, gerados por código, sempre iguais, normalizados e com a duração deles', () => {
  assert.deepEqual(dsp.SFX_IDS, ['whoosh', 'pop', 'palmas', 'tambor', 'ding', 'riser', 'boom', 'vinil']);
  for (const s of dsp.SFX) {
    const a = dsp.synthSfx(s.id, 16000), b = dsp.synthSfx(s.id, 16000);
    assert.equal(a.length, Math.round(s.seconds * 16000), `${s.id}: duração`);
    assert.deepEqual(a, b, `${s.id}: igual de cada vez (semente)`);
    let peak = 0, nan = false;
    for (const v of a) { peak = Math.max(peak, Math.abs(v)); if (!Number.isFinite(v)) nan = true; }
    assert.equal(nan, false, `${s.id}: sem NaN`);
    near(peak, 0.9, 1e-6, `${s.id}: pico`);
  }
  // A faixa dos efeitos: cada um no seu instante, o resto em silêncio, cortada no fim.
  const t = dsp.renderSfxTrack([{ id: 'pop', at: 1 }, { id: 'ding', at: 2.5 }, { id: 'boom', at: 9 }], 3, 8000);
  assert.equal(t.length, 24000);
  let before = 0; for (let i = 0; i < 8000; i++) before = Math.max(before, Math.abs(t[i]));
  assert.equal(before, 0, 'nada antes do primeiro');
  let at1 = 0; for (let i = 8000; i < 8800; i++) at1 = Math.max(at1, Math.abs(t[i]));
  assert.ok(at1 > 0.5, 'o pop ao 1 s');
  assert.deepEqual(dsp.renderSfxTrack([{ id: 'nada', at: 0 }], 1, 100), new Float32Array(100), 'ids desconhecidos não tocam');
});

test('efeitos de voz: os 7, o eco igual ao do servidor e o reverb normalizado', () => {
  assert.deepEqual(dsp.VOICE_FX.map((f) => f.name), ['Normal', 'Robô', 'Esquilo', 'Grave', 'Eco', 'Rádio', 'Estádio']);
  assert.ok(dsp.isVoiceFx('robo') && !dsp.isVoiceFx('x'));
  assert.deepEqual(dsp.echoTaps(280, 0.6, 0.45, 3), [{ ms: 280, gain: 0.6 }, { ms: 560, gain: 0.27 }, { ms: 840, gain: 0.1215 }]);
  assert.equal(dsp.radioShape(0), 0);
  near(dsp.radioShape(1), 1, 1e-12, 'a saturação do rádio não passa de 1');
  assert.ok(dsp.radioShape(0.2) > 0.2, 'e puxa os baixos para cima');
  const [l, r] = dsp.reverbImpulse(8000);
  assert.equal(l.length, Math.round(8000 * dsp.FX.estadio.seconds));
  let el = 0, er = 0; for (let i = 0; i < l.length; i++) { el += l[i] * l[i]; er += r[i] * r[i]; }
  near(el, 1, 1e-6, 'energia 1 (esquerda)'); near(er, 1, 1e-6, 'energia 1 (direita)');
  assert.equal(l[0], 0, 'com um pequeno atraso no início');
  assert.notDeepEqual(l, r, 'os dois canais são diferentes (estéreo)');
});

test('WAV: cabeçalho PCM 16 bits e as amostras cortadas a ±1', () => {
  const w = dsp.encodeWav([new Float32Array([0, 1, -1, 2])], 48000);
  const v = new DataView(w.buffer);
  assert.equal(String.fromCharCode(...w.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...w.subarray(8, 12)), 'WAVE');
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 8);
  assert.deepEqual([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true)), [0, 32767, -32768, 32767]);
});

test('o estado do som: assinaturas (o que recomeça e o que muda a tocar)', () => {
  const a = mix.defaultMix();
  assert.equal(a.musicStartMs, 0);
  assert.equal(a.ducking, true, 'o ducking vem ligado');
  const b = { ...a, fadeIn: 2, sfx: [{ key: 'k', id: 'pop', at: 1 }] };
  assert.deepEqual(mix.mixTimingParts(a), mix.mixTimingParts(b), 'fades e efeitos sonoros não recomeçam a pré-visualização');
  assert.notDeepEqual(mix.mixParts(a), mix.mixParts(b), 'mas mudam o vídeo final');
  assert.notDeepEqual(mix.mixTimingParts(a), mix.mixTimingParts({ ...a, musicStartMs: 4200 }), 'o trecho recomeça');
});

test('no estúdio: o painel do som está na caixa bloqueada; a gravação leva a mesma mistura; o microfone só a gravar', () => {
  const studio = read('components', 'TchekaStudio.tsx');
  const box = studio.indexOf("pointerEvents={locked ? 'none' : 'auto'}");
  const panel = studio.indexOf('<AudioPanel');
  const end = studio.indexOf('{pickMusic ? <MusicPicker');
  assert.ok(box > 0 && panel > box && panel < end, 'o painel do som fica dentro da caixa que a montagem bloqueia');
  assert.match(studio, /locked=\{locked\}\n\s+\/>/, 'e recebe o bloqueio');
  assert.match(studio, /if \(!rules\.ok \|\| progress !== null \|\| voiceMode\.current\.on\) return;/, 'não se monta a meio de gravar a voz');
  assert.match(studio, /voiceSeconds: voiceSecondsIn\(mix\.voice, playTotal\)/, 'a voz-off conta para a regra do som');
  assert.match(studio, /createStudioGraph\(ac, \{ origGain, musicGain, master \}\)/, 'os canais vão todos ao master (gravação e colunas)');
  assert.match(studio, /scheduleMix\(e\.graph, \{ from, total: end/, 'cada volta (também a gravação final) agenda a voz e os efeitos');
  assert.match(studio, /<AudioMarks mix=\{mix\} total=\{playTotal\} \/>/, 'as marcas na barra do tempo');
  const engine = read('lib', 'studio', 'audioEngine.ts');
  assert.match(engine, /voiceGain\.connect\(n\.master\)/);
  assert.match(engine, /sfxGain\.connect\(n\.master\)/);
  assert.match(engine, /s\.connect\(g\)\.connect\(ac\.destination\)/, 'ouvir ao arrastar vai só às colunas (não é gravado)');
  const voice = read('components', 'studio', 'AudioVoice.tsx');
  assert.match(voice, /getUserMedia\(/);
  assert.match(voice, /l\.stream\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/, 'o microfone desliga-se');
  assert.match(voice, /release\(\); \/\/ o microfone desliga-se aqui/, 'logo ao parar');
  assert.ok(voice.indexOf('getUserMedia(') > voice.indexOf('async function start()'), 'só se pede ao carregar em gravar');
  assert.match(voice, /for \(const n of \[3, 2, 1\]\)/, 'contagem 3-2-1');
});

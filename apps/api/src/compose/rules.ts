// CÓPIA FIEL de apps/mobile/src/lib/tchekaRules.ts (o estúdio do site): as mesmas regras e contas do estúdio do site,
// para a montagem no servidor (POST /tchekas/compose) dizer exatamente o mesmo. Não mudar só aqui: mudar lá e copiar para
// cá (o rules-sync.spec.ts compara os dois ficheiros quando estão os dois no repositório). Tudo o que vem abaixo da linha
// seguinte é igual ao original.
// ---- cópia ----
/**
 * As contas do estúdio de tchekas, sem React nem browser (testadas em tests/tchekaStudio.test.mjs):
 * - as regras mínimas para publicar e a dica do botão («Junta mais 2 fotos», «Escolhe uma música»); uma voz-off com 3 s ou
 *   mais também conta como o som da tcheka;
 * - a deteção das batidas de uma música (energia/onset, com Web Audio a dar as amostras) e a grelha do ritmo;
 * - a montagem ao ritmo (cada foto acaba numa batida);
 * - a gravação por clipes (barra segmentada até 60 s, velocidades 0,5× a 3×);
 * - o corte dos clipes e o tempo do texto.
 */

export const TCHEKA_MAX_S = 60;
/** Só com fotos: pelo menos 3. */
export const MIN_PHOTOS = 3;
/** Com vídeo: pelo menos 3 s de vídeo (os clipes gravados em seguida contam juntos, como no TikTok). */
export const MIN_VIDEO_S = 3;
/** Fotos e vídeos misturados: pelo menos 5 s no total. */
export const MIN_TOTAL_S = 5;
/** Uma voz-off com pelo menos 3 s (dentro da tcheka) conta como o som dela. */
export const MIN_VOICE_S = 3;
/** As velocidades da gravação (como no TikTok): 0,5× fica em câmara lenta, 3× fica acelerado. */
export const SPEEDS = [0.5, 1, 2, 3] as const;
export type Speed = (typeof SPEEDS)[number];
/** Ritmo fixo quando não se consegue ler a música (no nativo ou se o áudio não descodificar). */
export const FALLBACK_BPM = 120;

const EPS = 1e-6;

/** Um clipe da sequência, já com a duração que fica no vídeo final (cortado e com a velocidade). */
export interface RuleClip {
  video: boolean;
  /** Segundos no vídeo final. */
  seconds: number;
  /** Só nos vídeos: se têm som. `undefined` = ainda não se sabe (conta como tendo). */
  hasAudio?: boolean;
}
export interface RuleInput {
  clips: RuleClip[];
  /** Música do seletor ou um som de outra tcheka (`?som=`). */
  music: boolean;
  /** Volume do som original (0 a 1). A 0, o som dos vídeos não conta. */
  originalVolume?: number;
  /** Segundos de voz-off dentro da tcheka (0 sem voz-off). Com `MIN_VOICE_S` ou mais, conta como o som. */
  voiceSeconds?: number;
}
export type SoundSource = 'music' | 'original' | 'voz' | null;
export type RuleProblem = 'conteudo' | 'som' | 'longo' | 'vazio';
export interface RuleResult {
  ok: boolean;
  /** Segundos no vídeo final (antes de cortar aos 60). */
  total: number;
  photos: number;
  videoSeconds: number;
  /** De onde vem o som da tcheka. */
  sound: SoundSource;
  problem: RuleProblem | null;
  /** A dica do botão Publicar (null quando está tudo bem). */
  hint: string | null;
}

/** Arredonda para cima, com 1 s no mínimo (para as dicas: «Grava mais 2 s»). */
const upS = (s: number) => Math.max(1, Math.ceil(s - EPS));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** Segundos em texto com vírgula, sem casas a mais: 2 → «2», 1.5 → «1,5». */
export const fmtS = (s: number) => (Math.round(s * 10) / 10).toString().replace('.', ',');

/** As regras mínimas de uma tcheka (ver o topo do ficheiro). */
export function checkTcheka(input: RuleInput): RuleResult {
  const clips = input.clips.filter((c) => c.seconds > EPS);
  const photos = clips.filter((c) => !c.video).length;
  const videos = clips.filter((c) => c.video);
  const videoSeconds = videos.reduce((n, c) => n + c.seconds, 0);
  const total = clips.reduce((n, c) => n + c.seconds, 0);
  const vol = input.originalVolume ?? 1;
  const originalAudio = videos.some((c) => c.hasAudio !== false) && vol > EPS;
  const voice = Math.max(0, input.voiceSeconds ?? 0);
  const sound: SoundSource = input.music ? 'music' : originalAudio ? 'original' : voice >= MIN_VOICE_S - EPS ? 'voz' : null;
  const base = { total, photos, videoSeconds, sound };
  const fail = (problem: RuleProblem, hint: string): RuleResult => ({ ...base, ok: false, problem, hint });

  if (!clips.length) return fail('vazio', `Junta ${MIN_PHOTOS} fotos ou grava ${MIN_VIDEO_S} s`);
  const enough = photos >= MIN_PHOTOS || videoSeconds >= MIN_VIDEO_S - EPS || (videos.length > 0 && photos > 0 && total >= MIN_TOTAL_S - EPS);
  if (!enough) {
    if (!videos.length) return fail('conteudo', `Junta mais ${plural(MIN_PHOTOS - photos, 'foto', 'fotos')}`);
    const needVideo = MIN_VIDEO_S - videoSeconds;
    if (!photos) return fail('conteudo', `Grava mais ${upS(needVideo)} s`);
    const needMix = Math.min(needVideo, MIN_TOTAL_S - total);
    return fail('conteudo', `Junta mais ${plural(MIN_PHOTOS - photos, 'foto', 'fotos')} ou ${upS(needMix)} s de vídeo`);
  }
  if (!sound) {
    if (voice > EPS) return fail('som', `Grava mais ${upS(MIN_VOICE_S - voice)} s de voz-off ou escolhe uma música`);
    if (!videos.length) return fail('som', 'Escolhe uma música');
    if (vol <= EPS && videos.some((c) => c.hasAudio !== false)) return fail('som', 'Sobe o som original ou escolhe uma música');
    return fail('som', 'Os vídeos não têm som: escolhe uma música ou um som');
  }
  if (total > TCHEKA_MAX_S + 0.05) return fail('longo', `Tira ${upS(total - TCHEKA_MAX_S)} s (máximo ${TCHEKA_MAX_S} s)`);
  return { ...base, ok: true, problem: null, hint: null };
}

// ---------------------------------------------------------------- batidas

export interface BeatInfo {
  /** Os inícios fortes detetados (segundos). */
  onsets: number[];
  /** Andamento estimado (batidas por minuto), entre 70 e 180; null se a música não tiver ritmo claro. */
  bpm: number | null;
  /** Onde cai a primeira batida da grelha (segundos, entre 0 e um período). */
  offset: number;
}

/**
 * Deteção simples de batidas: energia em janelas de ~23 ms, a subida de energia (onset) acima da média local, picos
 * com pelo menos 200 ms entre eles; o andamento sai da autocorrelação da curva das subidas (70 a 180 BPM) e a fase é
 * a que junta mais energia nas batidas da grelha. `samples` é mono (ou o canal esquerdo) e `rate` a taxa de amostragem.
 */
export function detectBeats(samples: ArrayLike<number>, rate: number): BeatInfo {
  const hop = Math.max(1, Math.round(rate * 0.0116)); // ~11,6 ms
  const win = hop * 2;
  const frames = Math.floor((samples.length - win) / hop);
  if (frames < 8) return { onsets: [], bpm: null, offset: 0 };
  const energy = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const s0 = f * hop;
    for (let i = 0; i < win; i++) { const v = samples[s0 + i]; e += v * v; }
    energy[f] = Math.sqrt(e / win);
  }
  // Subidas de energia (só a parte positiva): é aqui que «bate».
  const flux = new Float64Array(frames);
  for (let f = 1; f < frames; f++) flux[f] = Math.max(0, energy[f] - energy[f - 1]);
  const fps = rate / hop;
  const half = Math.max(1, Math.round(fps * 0.5)); // média local de ±0,5 s
  const minGap = Math.round(fps * 0.2);
  let peak = 0;
  for (let f = 0; f < frames; f++) peak = Math.max(peak, flux[f]);
  const onsets: number[] = [];
  if (peak > 1e-9) {
    // Somas acumuladas para a média local.
    const acc = new Float64Array(frames + 1);
    for (let f = 0; f < frames; f++) acc[f + 1] = acc[f] + flux[f];
    let last = -Infinity;
    for (let f = 1; f < frames - 1; f++) {
      const a = Math.max(0, f - half), b = Math.min(frames, f + half + 1);
      const mean = (acc[b] - acc[a]) / (b - a);
      const v = flux[f];
      if (v > mean * 1.5 + peak * 0.08 && v >= flux[f - 1] && v >= flux[f + 1] && f - last >= minGap) {
        onsets.push(f / fps);
        last = f;
      }
    }
  }
  // Andamento: autocorrelação da curva das subidas (alisada ±3 janelas, para aguentar períodos que não caem certos
  // nas janelas) entre 70 e 180 BPM, normalizada pelo número de pares.
  const sm = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0, w = 0;
    for (let k = -3; k <= 3; k++) { const i = f + k; if (i >= 0 && i < frames) { const q = 4 - Math.abs(k); s += flux[i] * q; w += q; } }
    sm[f] = s / w;
  }
  let best = 0, bestLag = 0;
  const lagMin = Math.floor((fps * 60) / 180), lagMax = Math.ceil((fps * 60) / 70);
  const corr = new Float64Array(lagMax + 2);
  for (let lag = lagMin; lag <= lagMax && lag < frames; lag++) {
    let c = 0;
    for (let f = lag; f < frames; f++) c += sm[f] * sm[f - lag];
    corr[lag] = c / (frames - lag);
  }
  for (let lag = lagMin; lag <= lagMax && lag < frames; lag++) {
    // Preferência ligeira por andamentos perto de 120 (a «metade» e o «dobro» confundem-se).
    const bpm = (fps * 60) / lag;
    const w = 1 - 0.1 * Math.abs(Math.log2(bpm / 120));
    if (corr[lag] * w > best) { best = corr[lag] * w; bestLag = lag; }
  }
  if (!bestLag || best <= 1e-12 || onsets.length < 3) return { onsets, bpm: null, offset: onsets[0] ?? 0 };
  // Afinação abaixo da janela: o pico da parábola nos vizinhos.
  const y0 = corr[bestLag - 1] ?? 0, y1 = corr[bestLag], y2 = corr[bestLag + 1] ?? 0;
  const den = y0 - 2 * y1 + y2;
  const lag = bestLag + (Math.abs(den) > 1e-12 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0);
  const period = lag / fps;
  // Fase: o deslocamento da grelha que apanha mais subidas.
  let bestPhase = 0, bestSum = -1;
  const steps = Math.max(1, Math.round(lag));
  for (let p = 0; p < steps; p++) {
    let s = 0;
    for (let t = p; t < frames; t += lag) {
      const i = Math.round(t);
      s += Math.max(flux[i] ?? 0, flux[i - 1] ?? 0, flux[i + 1] ?? 0);
    }
    if (s > bestSum) { bestSum = s; bestPhase = p; }
  }
  return { onsets, bpm: Math.round(((fps * 60) / lag) * 10) / 10, offset: (bestPhase / fps) % period };
}

/** A grelha das batidas até `duration` (segundos): regular, a partir do andamento e da fase. */
export function beatGrid(bpm: number | null | undefined, offset: number, duration: number): number[] {
  const b = bpm && bpm > 30 && bpm < 300 ? bpm : FALLBACK_BPM;
  const period = 60 / b;
  const out: number[] = [];
  for (let t = ((offset % period) + period) % period; t <= duration + EPS; t += period) out.push(Math.round(t * 1000) / 1000);
  return out;
}

/** Um clipe na montagem ao ritmo: os vídeos ficam com a duração que têm; as fotos acabam numa batida. */
export interface RhythmItem { video: boolean; seconds: number; /** Só fotos: quantas batidas fica no ecrã (1, 2 ou 4). */ beats?: number }

/**
 * As durações ao ritmo: cada foto acaba `beats` batidas depois da primeira batida que já vem a seguir ao início dela
 * (pelo menos 0,25 s no ecrã). Os vídeos não mudam. Assim os cortes das fotos caem todos nas batidas da música.
 */
export function rhythmDurations(items: RhythmItem[], grid: number[]): number[] {
  if (!grid.length) return items.map((i) => i.seconds);
  const period = grid.length > 1 ? grid[1] - grid[0] : 60 / FALLBACK_BPM;
  const beatAt = (i: number) => (i < grid.length ? grid[i] : grid[grid.length - 1] + (i - grid.length + 1) * period);
  let t = 0;
  return items.map((it) => {
    if (it.video) { t += it.seconds; return it.seconds; }
    const n = Math.max(1, Math.round(it.beats ?? 2));
    let i = 0;
    while (beatAt(i) < t + 0.25 - EPS) i++;
    const end = beatAt(i + n - 1);
    const d = Math.round((end - t) * 1000) / 1000;
    t += d;
    return d;
  });
}

/** Onde há cortes no vídeo final (segundos): o fim de cada clipe, menos o último. */
export function cutTimes(durations: number[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (let i = 0; i < durations.length - 1; i++) { t += durations[i]; out.push(Math.round(t * 1000) / 1000); }
  return out;
}

// ---------------------------------------------------------------- gravação por clipes

/** Quanto um clipe gravado dura no vídeo final: a 2× fica com metade, a 0,5× com o dobro. */
export const finalMs = (recordedMs: number, speed: number) => recordedMs / (speed > 0 ? speed : 1);
/** Quanto ainda se pode gravar (ms reais, à velocidade escolhida) até o vídeo final chegar aos 60 s. */
export const recordableMs = (usedFinalMs: number, speed: number, maxS = TCHEKA_MAX_S) => Math.max(0, (maxS * 1000 - usedFinalMs) * (speed > 0 ? speed : 1));
/** Enquanto se grava a `speed`, a música toca a 1/speed (a 3× ouve-se devagar; no vídeo final fica a tempo). */
export const musicRateWhileRecording = (speed: number) => Math.min(4, Math.max(0.25, 1 / (speed > 0 ? speed : 1)));
/** A etiqueta da velocidade: «0,5×», «1×», «3×». */
export const speedLabel = (s: number) => `${String(s).replace('.', ',')}×`;

export interface Segment { start: number; width: number }
/**
 * A barra segmentada da gravação: cada clipe é um bocado (frações de 0 a 1 dos 60 s), pela ordem; o que passar dos
 * 60 s fica cortado. `liveMs` é o clipe a ser gravado agora (já em tempo final).
 */
export function segmentBar(clipsFinalMs: number[], liveMs = 0, maxS = TCHEKA_MAX_S): { segments: Segment[]; live: Segment | null; used: number } {
  const max = maxS * 1000;
  const segments: Segment[] = [];
  let at = 0;
  for (const ms of clipsFinalMs) {
    if (at >= max) break;
    const w = Math.min(ms, max - at);
    if (w > 0) segments.push({ start: at / max, width: w / max });
    at += w;
  }
  const lw = Math.min(Math.max(0, liveMs), max - at);
  return { segments, live: lw > 0 ? { start: at / max, width: lw / max } : null, used: Math.min(1, (at + lw) / max) };
}

// ---------------------------------------------------------------- corte e texto

export interface Trim { start: number; end: number }
/** Um corte válido dentro de `[0, length]`, com pelo menos `min` segundos. */
export function clampTrim(t: Trim, length: number, min = 0.5): Trim {
  const L = Math.max(0, length);
  const m = Math.min(min, L);
  const start = Math.min(Math.max(0, t.start), Math.max(0, L - m));
  const end = Math.max(Math.min(L, t.end), start + m);
  return { start: Math.round(start * 100) / 100, end: Math.round(Math.min(L, end) * 100) / 100 };
}
/** Quanto um vídeo dura no final: o bocado cortado, à velocidade dele. */
export const clipSeconds = (trim: Trim, speed: number) => Math.max(0, trim.end - trim.start) / (speed > 0 ? speed : 1);

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
/** A opacidade do texto no instante `t`: entra em 0,45 s a partir de `from` e sai em 0,4 s até `to`. */
export function textAlpha(t: number, from: number, to: number): number {
  if (t < from - EPS || t > to + EPS || to <= from) return 0;
  const inA = ease((t - from) / 0.45);
  const outA = t > to - 0.4 ? 1 - ease((t - (to - 0.4)) / 0.4) : 1;
  return Math.max(0, Math.min(inA, outA));
}

/** Uma assinatura curta da montagem (o que muda o vídeo final): serve para saber se a pré-visualização gravada ainda vale. */
export function studioSignature(parts: unknown): string {
  const s = JSON.stringify(parts);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + ':' + s.length;
}

/**
 * A pré-visualização do estúdio depois de uma mudança (corte, duração de uma foto, música, ritmo, escolher um clipe): continua
 * do ponto `at` (nunca volta ao início), a tocar se estava a tocar e parada no frame se estava em pausa. Perto do fim (ou depois
 * dele, se a sequência encolheu) recomeça do princípio.
 */
export function previewResume(o: { playing: boolean; at: number; total: number }): { action: 'play' | 'show'; at: number } {
  const total = Number.isFinite(o.total) && o.total > 0 ? o.total : 0;
  let at = Number.isFinite(o.at) && o.at > 0 ? o.at : 0;
  if (at >= total - 0.2) at = 0;
  return { action: o.playing ? 'play' : 'show', at };
}

/** «0:07 / 0:20»: o tempo da pré-visualização por baixo do botão de tocar. */
export function previewClock(t: number, total: number): string {
  const f = (s: number) => { const v = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0; return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };
  return `${f(Math.min(t, total))} / ${f(total)}`;
}

/** A edição do estúdio fica bloqueada enquanto a montagem corre (`progress` de 0 a 1; null quando não há montagem). */
export const editLocked = (progress: number | null | undefined): boolean => progress !== null && progress !== undefined;

/**
 * As contas da câmara do site (TxCamera), sem DOM: que restrições pedir e o plano B, que formato de vídeo gravar,
 * o recorte WYSIWYG (o que o visor mostra, em píxeis do sensor), o toque → ponto de foco, o zoom (ótico do
 * aparelho ou digital), as capacidades que o browser dá, os erros da câmara e como ligar a permissão em cada browser.
 * Fica aqui para se poder testar em Node (tests/webCamera.test.mjs).
 */

export type Facing = 'environment' | 'user';
/** O formato do sensor que se pede: 3:4 (foto, a imagem inteira do sensor) ou 16:9 (vídeo, mimo e tcheka). */
export type SensorRatio = '3:4' | '16:9';
export interface Rect { x: number; y: number; w: number; h: number }
export interface Range { min: number; max: number; step: number }

/** Prende `v` entre `lo` e `hi` (o `+ 0` tira o -0 dos arredondamentos). */
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v) + 0;

// ----- Restrições do getUserMedia -----

/** O formato que serve cada moldura: 4:5 (publicação) sai melhor do 3:4 inteiro; 9:16 (mimo, tcheka) do 16:9. */
export function sensorRatioFor(aspect: number): SensorRatio {
  return aspect >= 0.7 ? '3:4' : '16:9';
}

/**
 * O plano B, do melhor ao mais simples, para quando o pedido principal falha (OverconstrainedError, ou um aparelho
 * que não abre aquela resolução). O último é "qualquer câmara": antes isso do que nenhuma.
 */
export function fallbackConstraints(facing: Facing, ratio: SensorRatio): (MediaTrackConstraints | true)[] {
  const fm = { facingMode: { ideal: facing } };
  const mid = ratio === '3:4'
    ? { width: { ideal: 960 }, height: { ideal: 1280 }, aspectRatio: { ideal: 3 / 4 } }
    : { width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 } };
  return [{ ...fm, ...mid }, { ...fm, width: { ideal: 640 }, height: { ideal: 480 } }, fm, true];
}

/**
 * Foto numa publicação (3:4): se o sensor dá mais do que os 1080×1440 do pedido normal, sobe para 1440×1920
 * (fica 1440×1800 em 4:5). Não vai mais acima: o visor e a gravação no iPhone ficavam pesados. `null` = não mexer.
 */
export function photoUpgrade(caps: { width?: Partial<Range>; height?: Partial<Range> } | null | undefined, current: { width?: number; height?: number } | null | undefined, ratio: SensorRatio): MediaTrackConstraints | null {
  if (ratio !== '3:4' || !caps?.width?.max || !caps?.height?.max) return null;
  const long = Math.max(caps.width.max, caps.height.max), short = Math.min(caps.width.max, caps.height.max);
  const curLong = Math.max(current?.width ?? 0, current?.height ?? 0);
  if (long < 1920 || short < 1440 || curLong >= 1900) return null;
  return { width: { ideal: 1440 }, height: { ideal: 1920 }, aspectRatio: { ideal: 3 / 4 } };
}

// ----- Erros e permissões -----

export type CamProblem = 'denied' | 'busy' | 'nocamera' | 'insecure' | 'constraint' | 'failed';

/** O que correu mal, a partir do nome do erro do getUserMedia (cada browser usa os seus, incluindo os antigos). */
export function classifyCameraError(e: { name?: string; message?: string } | null | undefined, secure = true): CamProblem {
  const name = e?.name ?? '';
  if (!secure) return 'insecure';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied';
  // SecurityError: a página não pode usar a câmara (política do site ou ligação insegura).
  if (name === 'SecurityError') return 'denied';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'nocamera';
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError' || name === 'TypeError') return 'constraint';
  return 'failed';
}
/** Erros em que vale a pena tentar outra vez com restrições mais simples (o plano B). */
export const retryWithFallback = (p: CamProblem) => p === 'constraint' || p === 'busy' || p === 'failed';

export type BrowserKind = 'ios-safari' | 'ios-pwa' | 'ios-other' | 'android-chrome' | 'android-other' | 'desktop-chrome' | 'desktop-safari' | 'firefox' | 'other';

/** Que browser é, só para escolher as instruções certas (o cadeado não está no mesmo sítio em todos). */
export function browserKind(ua: string, standalone = false, touchMac = false): BrowserKind {
  const ios = /iPhone|iPad|iPod/.test(ua) || (touchMac && /Macintosh/.test(ua));
  if (ios) {
    if (standalone) return 'ios-pwa';
    if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return 'ios-other';
    return 'ios-safari';
  }
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Android/.test(ua)) return /Chrome\//.test(ua) && !/SamsungBrowser|EdgA|OPR\//.test(ua) ? 'android-chrome' : 'android-other';
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'desktop-chrome';
  if (/Safari\//.test(ua) && /Macintosh/.test(ua)) return 'desktop-safari';
  return 'other';
}

/** Os passos para voltar a ligar a câmara, em cada browser. */
export function permissionSteps(kind: BrowserKind): string[] {
  switch (kind) {
    case 'ios-safari':
      return ['Toca em «aA» (ou no botão ⋯) ao lado do endereço.', 'Escolhe Definições do site › Câmara › Permitir.', 'Volta aqui e toca em Tentar outra vez.'];
    case 'ios-pwa':
      return ['Abre as Definições do iPhone › Apps › Safari › Câmara.', 'Escolhe Permitir (ou Perguntar).', 'Fecha o Txillapp e volta a abri-lo.'];
    case 'ios-other':
      return ['Abre as Definições do iPhone e procura este browser na lista de apps.', 'Liga a Câmara (e o Microfone, para vídeo).', 'Volta aqui e toca em Tentar outra vez.'];
    case 'android-chrome':
      return ['Toca no ícone à esquerda do endereço (o cadeado ou as definições).', 'Abre Permissões › Câmara › Permitir.', 'Se não aparecer: Definições do Android › Apps › Chrome › Permissões › Câmara.'];
    case 'android-other':
      return ['Toca no cadeado ao lado do endereço e permite a Câmara.', 'Se não der: Definições do Android › Apps › este browser › Permissões › Câmara.'];
    case 'desktop-chrome':
      return ['Clica no ícone à esquerda do endereço.', 'Põe a Câmara em Permitir.', 'Recarrega a página.'];
    case 'desktop-safari':
      return ['No menu Safari › Definições › Websites › Câmara.', 'Escolhe Permitir para este site e recarrega a página.'];
    case 'firefox':
      return ['Clica no ícone da câmara riscada ao lado do endereço.', 'Tira o bloqueio e recarrega a página.'];
    default:
      return ['Abre as definições do site no teu browser (normalmente no cadeado ao lado do endereço).', 'Permite a Câmara e recarrega a página.'];
  }
}

// ----- Gravação de vídeo -----

const MP4 = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4d002a,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4;codecs=h264,aac'];
const WEBM = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

/**
 * O melhor formato que o MediaRecorder grava. MP4/H.264 primeiro em todo o lado (abre em qualquer telemóvel e o
 * iPhone codifica-o no hardware); no iPhone nunca WebM (o VP9 lá é por software e aquece). Depois WebM/VP9, VP8.
 */
export function pickRecorderType(isSupported: (t: string) => boolean, ios: boolean): string {
  const safe = (t: string) => { try { return isSupported(t); } catch { return false; } };
  const order = ios ? [...MP4, 'video/mp4'] : [...MP4, WEBM[0], 'video/mp4', ...WEBM.slice(1)];
  return order.find(safe) ?? '';
}
/** O tipo do ficheiro (sem os codecs) e a extensão. */
export function recorderFile(mime: string): { type: string; ext: 'mp4' | 'webm' } {
  const type = (mime || 'video/mp4').split(';')[0].trim() || 'video/mp4';
  return { type, ext: type.includes('webm') ? 'webm' : 'mp4' };
}
/** Bits por segundo para a resolução: ~8 Mb/s em 1080p30; nunca abaixo de 2,5 nem acima de 10 (60 s ficam < 80 MB). */
export function videoBitrate(w: number | undefined, h: number | undefined, fps: number | undefined): number {
  const px = (w || 1280) * (h || 720) * clamp(fps || 30, 15, 60);
  return Math.round(clamp(px * 0.13, 2_500_000, 10_000_000));
}
/** "0:07" */
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ----- Geometria: visor "cover" com zoom ↔ píxeis do sensor -----

/**
 * O retângulo do vídeo (em píxeis reais, videoWidth×videoHeight) que o visor mostra dentro de `cell`.
 * O vídeo enche `view` com object-fit: cover, centrado, e ainda leva `zoom` (escala CSS à volta do centro);
 * `mirror` = visor espelhado (câmara da frente). `cell` e `view` em píxeis do ecrã, no mesmo referencial.
 */
export function coverCrop(srcW: number, srcH: number, view: Rect, cell: Rect, zoom = 1, mirror = false): Rect {
  const k = Math.max(view.w / srcW, view.h / srcH) * Math.max(1, zoom);
  const vx0 = (srcW - view.w / k) / 2, vy0 = (srcH - view.h / k) / 2;
  let sx = vx0 + (cell.x - view.x) / k;
  let sy = vy0 + (cell.y - view.y) / k;
  let sw = cell.w / k, sh = cell.h / k;
  if (mirror) sx = srcW - sx - sw;
  // Arredonda para píxeis inteiros sem nunca sair do sensor.
  sw = clamp(Math.round(sw), 1, srcW);
  sh = clamp(Math.round(sh), 1, srcH);
  sx = clamp(Math.round(sx), 0, srcW - sw);
  sy = clamp(Math.round(sy), 0, srcH - sh);
  return { x: sx, y: sy, w: sw, h: sh };
}

/** Onde se tocou (px dentro do visor) em coordenadas do sensor (0–1), como o pointsOfInterest quer. */
export function tapToPoint(tapX: number, tapY: number, viewW: number, viewH: number, srcW: number, srcH: number, zoom = 1, mirror = false): { x: number; y: number } {
  const k = Math.max(viewW / srcW, viewH / srcH) * Math.max(1, zoom);
  const sx = (srcW - viewW / k) / 2 + tapX / k, sy = (srcH - viewH / k) / 2 + tapY / k;
  const x = clamp(sx / srcW, 0, 1), y = clamp(sy / srcH, 0, 1);
  return { x: mirror ? 1 - x : x, y };
}

/**
 * A foto do ImageCapture costuma ter outro formato do que o vídeo (o sensor inteiro, 4:3, quando o vídeo é 16:9):
 * o vídeo é o centro da foto. Passa um recorte em píxeis do vídeo para píxeis da foto.
 */
export function videoCropToPhoto(crop: Rect, vw: number, vh: number, pw: number, ph: number): Rect {
  const k = Math.min(pw / vw, ph / vh);
  const ox = (pw - vw * k) / 2, oy = (ph - vh * k) / 2;
  const w = clamp(Math.round(crop.w * k), 1, pw), h = clamp(Math.round(crop.h * k), 1, ph);
  return { x: clamp(Math.round(ox + crop.x * k), 0, pw - w), y: clamp(Math.round(oy + crop.y * k), 0, ph - h), w, h };
}

/** Correlação normalizada entre duas miniaturas cinzentas do mesmo tamanho (-1 a 1); 0 se uma for lisa. */
export function ncc(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  if (da / n < 9 || db / n < 9) return 0; // imagem quase lisa (desvio < 3 níveis): não dá para comparar
  return num / Math.sqrt(da * db);
}
/**
 * Qual das orientações da foto bate com o que o visor mostrou (o ImageCapture nem sempre devolve a foto direita).
 * Devolve o índice da melhor, ou -1 se nenhuma bate bem (aí fica a imagem do vídeo, que é segura).
 */
export function bestMatch(scores: number[], min = 0.6): number {
  let best = -1;
  for (let i = 0; i < scores.length; i++) if (scores[i] >= min && (best < 0 || scores[i] > scores[best])) best = i;
  return best;
}

// ----- Zoom -----

/**
 * Divide o zoom pedido entre o do aparelho (se o browser o der: Android, alguns iPhone) e o digital (escala do vídeo
 * e recorte). Com zoom do aparelho, o digital só entra para lá do máximo dele.
 */
export function zoomPlan(total: number, hw: Range | null): { hw: number | null; digital: number } {
  if (!hw) return { hw: null, digital: Math.max(1, total) };
  const z = clamp(total, hw.min, hw.max);
  const snapped = hw.step > 0 ? clamp(hw.min + Math.round((z - hw.min) / hw.step) * hw.step, hw.min, hw.max) : z;
  return { hw: snapped, digital: Math.max(1, total / Math.max(snapped, 0.01)) };
}
/** Até onde o zoom vai: o do aparelho (até 10×) ou 5× digital. O mínimo é 1× (ou 0,5× se o aparelho tiver grande-angular). */
export function zoomLimits(hw: Range | null): { min: number; max: number } {
  if (!hw) return { min: 1, max: 5 };
  return { min: hw.min < 1 ? Math.max(0.5, hw.min) : 1, max: clamp(hw.max, 2, 10) };
}
/** As pílulas: 1× e 2× (e 0,5× quando há grande-angular). */
export function zoomPills(hw: Range | null): number[] {
  return zoomLimits(hw).min < 1 ? [0.5, 1, 2] : [1, 2];
}
/** "1×", "1,4×", "2×" (com vírgula, como em português). */
export function zoomLabel(z: number): string {
  const r = Math.round(z * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1).replace('.', ',')}×`;
}
/** A pílula que fica acesa para um zoom (a mais próxima por baixo), como na câmara do iPhone. */
export function activePill(z: number, pills: number[]): number {
  let on = pills[0];
  for (const p of pills) if (z >= p - 0.05) on = p;
  return on;
}

// ----- Capacidades -----

export interface CamCaps {
  zoom: Range | null;
  torch: boolean;
  /** Foco no ponto tocado (pointsOfInterest + um focusMode que o aceite). */
  focus: boolean;
  focusMode: 'continuous' | 'single-shot' | null;
  exposure: Range | null;
  /** Flash a sério na foto (ImageCapture com fillLightMode "flash"). */
  flash: boolean;
}
const range = (r: unknown): Range | null => {
  const o = r as Partial<Range> | undefined;
  if (!o || typeof o.min !== 'number' || typeof o.max !== 'number' || !(o.max > o.min)) return null;
  return { min: o.min, max: o.max, step: typeof o.step === 'number' && o.step > 0 ? o.step : 0 };
};
/**
 * O que a câmara aberta deixa fazer, lido das getCapabilities() da track (e do getPhotoCapabilities() do ImageCapture).
 * Sem a capacidade, o controlo não aparece.
 */
export function readCaps(caps: Record<string, unknown> | null | undefined, supported?: Record<string, unknown> | null, photo?: { fillLightMode?: string[] } | null): CamCaps {
  const c = caps ?? {};
  const zoom = range(c.zoom);
  const modes = Array.isArray(c.focusMode) ? (c.focusMode as string[]) : [];
  const focusMode = modes.includes('continuous') ? 'continuous' : modes.includes('single-shot') ? 'single-shot' : null;
  const poi = !!supported?.pointsOfInterest || 'pointsOfInterest' in c;
  const exposure = range(c.exposureCompensation);
  return {
    zoom: zoom && zoom.max > 1 ? zoom : null,
    torch: c.torch === true || (Array.isArray(c.torch) && (c.torch as unknown[]).includes(true)),
    focus: !!focusMode && poi,
    focusMode,
    exposure: exposure && exposure.max > 0 && exposure.min < 0 ? exposure : null,
    flash: !!photo?.fillLightMode?.includes('flash'),
  };
}
/** O valor da exposição a partir do deslize (-1 a 1), no passo da câmara. */
export function exposureValue(t: number, r: Range): number {
  const v = t >= 0 ? clamp(t, 0, 1) * r.max : clamp(-t, 0, 1) * r.min;
  const s = r.step > 0 ? Math.round(v / r.step) * r.step : v;
  return Math.round(clamp(s, r.min, r.max) * 100) / 100;
}
/** "+0,7", "−1", "0" */
export function exposureLabel(v: number): string {
  if (Math.abs(v) < 0.05) return '0';
  const r = Math.round(Math.abs(v) * 10) / 10;
  return `${v > 0 ? '+' : '−'}${Number.isInteger(r) ? r : r.toFixed(1).replace('.', ',')}`;
}

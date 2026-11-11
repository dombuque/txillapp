/**
 * Câmara nativa (NativeCamera.tsx, react-native-vision-camera v5): a lógica pura dos controlos — lentes e zoom, foco,
 * exposição, flash, formato e as mensagens de problemas. Sem React nem VisionCamera aqui dentro, para se poder testar em
 * Node (tests/cameraControls.test.mjs).
 *
 * Duas unidades de zoom:
 * - "aparelho": o número que a VisionCamera recebe em `setZoom` (no iPhone com ultra grande angular, 1 = a 0,5×);
 * - "mostrado": o que as pessoas conhecem (0,5× · 1× · 2× · 3×). mostrado = aparelho × multiplicador.
 */

export type CamPlatform = 'ios' | 'android';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ———————————————————————————————————————— Lentes e zoom ————————————————————————————————————————

export type LensInfo = {
  platform: CamPlatform;
  /** Limites do aparelho (em unidades do aparelho). */
  minZoom: number;
  maxZoom: number;
  /** `device.zoomLensSwitchFactors`: onde a câmara virtual do iPhone passa para outra lente (ex.: [2, 6]). */
  switchFactors: number[];
  /** Tem uma ultra grande angular entre as lentes físicas. */
  hasUltraWide: boolean;
  /** Câmara de trás (a da frente não tem pílulas de lentes). */
  back: boolean;
  /** `controller.displayableZoomFactor / controller.zoom`, se já houver controlador (no Android = intrinsicZoomRatio). */
  ctrlRatio?: number;
};

/**
 * Multiplicador de unidades do aparelho para unidades mostradas.
 * - iPhone com ultra grande angular: a lente principal entra no primeiro fator de troca (normalmente 2), por isso
 *   1× mostrado = 2 no aparelho e o multiplicador é 0,5. Calcula-se aqui porque o `displayableZoomFactor` só vem certo
 *   a partir do iOS 18.
 * - Android: a câmara lógica do CameraX já tem 1 = lente principal; usa-se o rácio do controlador se for razoável.
 */
export function displayMultiplier(info: Pick<LensInfo, 'platform' | 'switchFactors' | 'hasUltraWide' | 'ctrlRatio'>): number {
  if (info.platform === 'ios') {
    const first = info.switchFactors[0];
    return info.hasUltraWide && finite(first) && first > 1 ? 1 / first : 1;
  }
  const r = info.ctrlRatio;
  return finite(r) && r >= 0.2 && r <= 5 ? r : 1;
}

/**
 * Limites do zoom que se podem usar. No Android a VisionCamera devolve `minZoom`/`maxZoom` = 0 quando o CameraX ainda
 * não tem o estado do zoom dessa câmara; com 0 o zoom pedido seria 0 (fora do intervalo: a câmara recusa-o e o Zás
 * ficava "não pronto"). Sem valores válidos fica 1…1 (sem zoom), e o máximo nunca fica abaixo do mínimo.
 */
export function zoomBounds(min: unknown, max: unknown): { min: number; max: number } {
  const lo = finite(min) && min > 0 ? min : 1;
  const hi = finite(max) && max > 0 ? max : lo;
  return { min: lo, max: Math.max(lo, hi) };
}

/** Arredonda um ponto de lente para uma casa decimal (0,5 · 0,6 · 1 · 2 · 3 · 5). */
const roundStop = (d: number) => Math.round(d * 10) / 10;

/** Até onde a interface deixa ampliar (mostrado): 10×, ou o dobro da maior tele (ex.: 5× → 10×). */
export function maxDisplayZoom(info: LensInfo, mult: number): number {
  const deviceMax = info.maxZoom * mult;
  const tele = info.platform === 'ios' ? Math.max(0, ...info.switchFactors.map((f) => f * mult)) : 0;
  return Math.max(1, Math.min(deviceMax, Math.max(10, tele * 2)));
}

/**
 * As pílulas de lente (em unidades mostradas), ordenadas: 0,5 (ultra grande angular, se houver) · 1 · tele(s) do iPhone
 * · e um 2× digital quando não há nenhuma lente a partir de 2× (como no iPhone sem tele e no Instagram).
 * A câmara da frente não tem pílulas (devolve só [1]).
 */
export function zoomStops(info: LensInfo, mult: number): number[] {
  if (!info.back) return [1];
  const maxD = maxDisplayZoom(info, mult);
  const out: number[] = [];
  const minD = info.minZoom * mult;
  if (minD < 0.95) out.push(roundStop(minD));
  out.push(1);
  if (info.platform === 'ios') {
    info.switchFactors.forEach((f, i) => {
      if (info.hasUltraWide && i === 0) return; // é a passagem para a lente principal (o 1×)
      const d = roundStop(f * mult);
      if (d > 1.05) out.push(d);
    });
  }
  if (!out.some((d) => d >= 1.9) && maxD >= 2) out.push(2);
  return [...new Set(out)].filter((d) => d <= maxD + 1e-6).sort((a, b) => a - b);
}

/** A pílula acesa para um zoom (mostrado): a maior lente que já se alcançou (com folga de 0,05). */
export function activeStop(stops: number[], display: number): number {
  let best = stops[0] ?? 1;
  for (const s of stops) if (display + 0.05 >= s) best = s;
  return best;
}

/**
 * Texto do zoom: "1,6×", "2×", "0,5×", "12×". Inteiro quando está a menos de 0,05 de um inteiro; uma casa decimal até
 * 10×; a partir de 10×, inteiro. `sep` é o separador decimal (vírgula, em português).
 */
export function formatZoom(display: number, sep = ','): string {
  if (!finite(display) || display <= 0) return `1×`;
  const r = Math.round(display);
  if (display >= 10 || (Math.abs(display - r) < 0.05 && r >= 1)) return `${r}×`;
  return `${(Math.round(display * 10) / 10).toFixed(1).replace('.', sep)}×`;
}

/** Texto de uma pílula apagada (sem "×", como no iPhone): "0,5", "1", "3". */
export function formatStop(stop: number, sep = ','): string {
  return Number.isInteger(stop) ? String(stop) : stop.toFixed(1).replace('.', sep);
}

/** Etiqueta de acessibilidade do zoom: "Zoom 1,6 vezes". */
export function zoomA11y(display: number, sep = ','): string {
  return `Zoom ${formatZoom(display, sep).replace('×', '')} vezes`;
}

/** Pinça: o zoom segue a escala dos dedos (proporcional, por isso suave em todo o lado) e fica dentro dos limites. */
export function pinchZoom(z0: number, scale: number, min: number, max: number): number {
  if (!finite(scale) || scale <= 0) return clamp(z0, min, max);
  return clamp(z0 * scale, min, max);
}

/** A gravar, deslizar o dedo para cima a partir do obturador: cada `ptsPerDoubling` pt duplicam o zoom (como no Instagram). */
export function slideZoom(z0: number, dyUp: number, min: number, max: number, ptsPerDoubling = 120): number {
  if (!finite(dyUp)) return clamp(z0, min, max);
  return clamp(z0 * Math.pow(2, dyUp / ptsPerDoubling), min, max);
}

/** Se o zoom (mostrado) passou por uma lente entre `prev` e `next`, devolve-a (para um toque háptico); senão `null`. */
export function crossedStop(prev: number, next: number, stops: number[]): number | null {
  if (!finite(prev) || !finite(next) || prev === next) return null;
  const lo = Math.min(prev, next), hi = Math.max(prev, next);
  for (const s of stops) {
    // Conta tocar exatamente na lente vindo de fora, não sair dela.
    if (s > lo && s < hi) return s;
    if (s === next && s !== prev) return s;
  }
  return null;
}

/**
 * O segundo argumento de `startZoomAnimation(zoom, rate)` não é igual nas duas plataformas na VisionCamera 5:
 * - iPhone: `rate` é a velocidade do AVCaptureDevice.ramp, em "duplicações por segundo";
 * - Android: é a duração da animação, em milissegundos.
 * Devolve o valor que faz a troca de lente durar ~`ms`.
 */
export function zoomAnimationArg(platform: CamPlatform, from: number, to: number, ms = 260): number {
  if (platform === 'android') return ms;
  if (!(from > 0) || !(to > 0)) return 8;
  const doublings = Math.abs(Math.log2(to / from));
  return Math.max(1, doublings / (ms / 1000));
}

// ———————————————————————————————————————— Foco e exposição ————————————————————————————————————————

/**
 * Ponto tocado no visor → ponto na vista da câmara. A vista da câmara (9:16) é maior do que o visor e está centrada
 * nele (cortada dos lados ou em cima/baixo), por isso só se soma o que fica de fora. A rotação, o espelho da frontal e
 * o corte da imagem do sensor já são tratados pela VisionCamera (`createMeteringPoint` da PreviewView).
 */
export function previewPoint(x: number, y: number, view: { w: number; h: number }, cam: { w: number; h: number }): { x: number; y: number } {
  const ox = (cam.w - view.w) / 2;
  const oy = (cam.h - view.h) / 2;
  return { x: clamp(x, 0, view.w) + ox, y: clamp(y, 0, view.h) + oy };
}

/** O canto do quadrado de foco (tamanho `box`) centrado no toque, sem sair do visor. */
export function focusBoxOrigin(x: number, y: number, box: number, view: { w: number; h: number }): { left: number; top: number } {
  return {
    left: clamp(x - box / 2, 0, Math.max(0, view.w - box)),
    top: clamp(y - box / 2, 0, Math.max(0, view.h - box)),
  };
}

/** Onde fica a barra do sol: à direita do quadrado, ou à esquerda se não couber; centrada na altura do toque. */
export function exposureBarOrigin(
  boxLeft: number, boxTop: number, box: number, barW: number, barH: number, view: { w: number; h: number }, gap = 6,
): { left: number; top: number } {
  const right = boxLeft + box + gap;
  const left = right + barW <= view.w ? right : Math.max(0, boxLeft - gap - barW);
  const top = clamp(boxTop + box / 2 - barH / 2, 8, Math.max(8, view.h - barH - 8));
  return { left, top };
}

export type MeteringMode = 'AE' | 'AF' | 'AWB';
/** Os modos de medição que a câmara aceita (pedir um que ela não tem faz o `focusTo` falhar). */
export function meteringModes(d: { af: boolean; ae: boolean; awb: boolean }): MeteringMode[] {
  const m: MeteringMode[] = [];
  if (d.ae) m.push('AE');
  if (d.af) m.push('AF');
  if (d.awb) m.push('AWB');
  return m;
}

export type ExposureRange = { min: number; max: number; integer: boolean };
/**
 * O intervalo da barra do sol.
 * - iPhone: EV, limitado a ±2 (como na câmara do iPhone; o aparelho deixa ±8, que é inútil e muito sensível).
 * - Android: o índice de compensação do CameraX (inteiros), o intervalo todo da câmara (normalmente ±2 EV).
 */
export function exposureRange(platform: CamPlatform, min: number, max: number): ExposureRange | null {
  if (!finite(min) || !finite(max) || max <= min) return null;
  if (platform === 'ios') {
    const lo = Math.max(min, -2), hi = Math.min(max, 2);
    return hi > lo ? { min: lo, max: hi, integer: false } : null;
  }
  const lo = Math.ceil(min), hi = Math.floor(max);
  return hi > lo ? { min: lo, max: hi, integer: true } : null;
}

/** Arrastar para cima clareia: `dyUp` pt para cima (negativo = para baixo); `travel` pt percorrem o intervalo todo. */
export function exposureFromDrag(v0: number, dyUp: number, r: ExposureRange, travel: number): number {
  const v = clamp(v0 + (dyUp / Math.max(1, travel)) * (r.max - r.min), r.min, r.max);
  return r.integer ? Math.round(v) : Math.round(v * 100) / 100;
}

/** Um passo do leitor de ecrã (aumentar/diminuir): 1 no Android (índice), um décimo do intervalo no iPhone. */
export function exposureStep(r: ExposureRange): number {
  return r.integer ? 1 : (r.max - r.min) / 10;
}

/** Posição do sol (0 = topo da barra) para o valor `v`: em cima = mais claro. */
export function sunOffset(v: number, r: ExposureRange | null, trackH: number, sun: number): number {
  const t = r ? clamp((v - r.min) / (r.max - r.min), 0, 1) : 0.5;
  return (1 - t) * Math.max(0, trackH - sun);
}

/** Passou pelo zero (para um toque leve, como no iPhone). */
export function crossedZero(prev: number, next: number): boolean {
  return (prev < 0 && next >= 0) || (prev > 0 && next <= 0);
}

// ———————————————————————————————————————— Flash e luz ————————————————————————————————————————

export type FlashChoice = 'off' | 'on' | 'auto';

/** Ordem do botão do flash: desligado → automático → ligado → desligado (como no iPhone). */
export function nextFlash(f: FlashChoice): FlashChoice {
  return f === 'off' ? 'auto' : f === 'auto' ? 'on' : 'off';
}

/** O modo a pedir na foto: sem flash físico pede-se sempre 'off' (pedir 'on' sem flash dá erro na VisionCamera). */
export function photoFlashMode(f: FlashChoice, hasFlash: boolean): FlashChoice {
  return hasFlash ? f : 'off';
}

/**
 * Pouca luz, pelo que a câmara está a usar (iPhone: ISO e tempo de exposição do controlador). No Android estes valores
 * vêm a 0 (o CameraX não os dá): devolve `false`.
 */
export function isLowLight(m: { iso?: number; exposureDuration?: number }): boolean {
  const iso = finite(m.iso) ? m.iso : 0;
  const dur = finite(m.exposureDuration) ? m.exposureDuration : 0;
  if (iso <= 0 && dur <= 0) return false;
  return iso >= 1000 || dur >= 1 / 25;
}

/** Flash de ecrã (frontal sem flash): ligado, ou automático com pouca luz. */
export function needsScreenFlash(f: FlashChoice, hasFlash: boolean, front: boolean, lowLight: boolean): boolean {
  if (hasFlash || !front) return false;
  return f === 'on' || (f === 'auto' && lowLight);
}

/** A lanterna a gravar vídeo: com o flash ligado, ou automático com pouca luz; só onde há lanterna. */
export function torchFor(f: FlashChoice, recording: boolean, hasTorch: boolean, lowLight: boolean): 'on' | 'off' {
  if (!recording || !hasTorch) return 'off';
  return f === 'on' || (f === 'auto' && lowLight) ? 'on' : 'off';
}

/** Texto do flash para o leitor de ecrã. */
export function flashA11y(f: FlashChoice, screen: boolean): string {
  const s = f === 'off' ? 'desligado' : f === 'on' ? 'ligado' : 'automático';
  return `${screen ? 'Flash de ecrã' : 'Flash'}: ${s}`;
}

// ———————————————————————————————————————— Formato e qualidade ————————————————————————————————————————

export type StabMode = 'standard' | 'cinematic' | 'cinematic-extended' | 'preview-optimized' | 'cinematic-extended-enhanced' | 'low-latency' | 'off' | 'auto';

/**
 * A estabilização do vídeo: a mais forte que não atrase muito (iPhone: 'cinematic', a do modo vídeo da câmara do
 * iPhone; senão 'standard'); no Android a 'standard' (EIS). Se a câmara não tiver nenhuma, 'auto'.
 */
export function pickStabilization(platform: CamPlatform, supports: (m: StabMode) => boolean): StabMode {
  const order: StabMode[] = platform === 'ios' ? ['cinematic', 'standard'] : ['standard'];
  for (const m of order) {
    try {
      if (supports(m)) return m;
    } catch {
      /* a câmara não respondeu: tenta a próxima */
    }
  }
  return 'auto';
}

/** Fotogramas do vídeo: 30 (o normal das redes; melhor com pouca luz e ficheiros mais pequenos), se a câmara o tiver. */
export function pickVideoFps(supports: (fps: number) => boolean): number | null {
  try {
    return supports(30) ? 30 : null;
  } catch {
    return null;
  }
}

/**
 * Prioridade da foto: 'balanced' nas duas. No iPhone é o que a câmara do iPhone usa (Smart HDR sem a espera do Deep
 * Fusion); no Android é o CAPTURE_MODE_MINIMIZE_LATENCY do CameraX ('quality' faz esperar 1–2 s em muitos Android).
 */
export function photoPriority(_platform: CamPlatform): 'speed' | 'balanced' | 'quality' {
  return 'balanced';
}

// ———————————————————————————————————————— Permissões e problemas ————————————————————————————————————————

export type PermStatus = 'not-determined' | 'authorized' | 'denied' | 'restricted';
export type PermView = { title: string; body: string; action: 'request' | 'settings' | 'none'; label: string };

/**
 * O ecrã sem licença da câmara. `refusedNow`: a pessoa acabou de recusar (no Android o estado continua
 * "not-determined" depois da primeira recusa, por isso mostra-se logo o caminho das definições também).
 */
export function permissionView(status: PermStatus, refusedNow = false): PermView {
  if (status === 'restricted') {
    return { title: 'Câmara bloqueada', body: 'O acesso à câmara está bloqueado por restrições deste telemóvel (controlo parental ou do trabalho).', action: 'none', label: '' };
  }
  if (status === 'denied' || refusedNow) {
    return { title: 'Sem acesso à câmara', body: 'Recusaste o acesso à câmara. Para tirar fotos e gravar vídeos aqui, ativa a Câmara nas definições do Txillapp.', action: 'settings', label: 'Abrir definições' };
  }
  return { title: 'A câmara do Txillapp', body: 'Dá acesso à câmara para tirar fotos e gravar vídeos aqui mesmo.', action: 'request', label: 'Permitir a câmara' };
}

export type CamProblem = { title: string; body: string; retry: boolean };

/** A mensagem quando a câmara para: interrupção (passa sozinha) ou erro (com "Tentar outra vez"). */
export function cameraProblem(
  kind: 'interruption' | 'error',
  opts: { reason?: string; message?: string; usedByAnotherApp?: boolean } = {},
): CamProblem {
  const reason = opts.reason ?? '';
  const msg = (opts.message ?? '').toLowerCase();
  const busy = !!opts.usedByAnotherApp || reason === 'video-device-in-use-by-another-client' || reason === 'video-device-not-available-with-multiple-foreground-apps' || msg.includes('in use') || msg.includes('max_cameras') || msg.includes('maximum number of open cameras');
  if (busy) return { title: 'A câmara está ocupada', body: 'Outra app está a usar a câmara. Fecha-a e volta aqui.', retry: kind === 'error' };
  if (reason === 'video-device-not-available-due-to-system-pressure') return { title: 'O telemóvel está quente', body: 'A câmara parou um pouco para o telemóvel arrefecer.', retry: false };
  if (reason === 'audio-device-in-use-by-another-client') return { title: 'Microfone ocupado', body: 'Outra app está a usar o microfone (uma chamada?). A câmara volta quando ela largar.', retry: false };
  if (msg.includes('disabled') || msg.includes('policy')) return { title: 'Câmara desativada', body: 'A câmara está desativada neste telemóvel (política do aparelho).', retry: false };
  if (msg.includes('do-not-disturb')) return { title: 'Modo Não incomodar', body: 'Este telemóvel não abre a câmara com o modo Não incomodar ligado.', retry: true };
  if (kind === 'interruption') return { title: 'A câmara parou', body: 'Volta a ligar-se sozinha daqui a nada.', retry: false };
  return { title: 'A câmara falhou', body: 'Alguma coisa correu mal com a câmara.', retry: true };
}

/**
 * Erros pequenos que a VisionCamera manda para o mesmo `onError` da sessão (o zoom fora dos limites ao trocar de câmara,
 * a exposição, a lanterna, o foco): não param a câmara e não merecem o aviso de "a câmara falhou".
 */
export function isMinorCameraError(message: string | undefined): boolean {
  // "Camera is not active." / "Camera is closed": o CameraX recusa o zoom, a exposição e a lanterna enquanto a câmara
  // está parada (editor ou galeria por cima, a abrir num telemóvel lento, a trocar de modo). Não é uma avaria.
  return /zoom|exposure|torch|focus|metering|flash|white.?balance|not yet ready|not active|is closed|canceled|cancelled/i.test(message ?? '');
}

/**
 * Chama um método nativo da câmara "dispara e esquece" sem nunca rebentar: alguns métodos da VisionCamera atiram logo
 * (ex.: `cancelZoomAnimation` do `CameraRef` atira "Camera is not yet ready!" antes de haver controlador, e o Nitro
 * passa exceções do Kotlin/Swift como exceções síncronas) e outros devolvem uma promessa que rejeita. Uma exceção num
 * gesto ou num toque fecha a app em release; uma promessa rejeitada sem `catch` dá um aviso. Aqui apanham-se as duas.
 */
export function quiet(f: () => unknown): void {
  try {
    const p = f() as { catch?: (fn: () => void) => unknown } | null | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  } catch {
    /* a câmara não estava pronta ou já foi largada: não há nada a fazer */
  }
}

/** Abaixo disto (ms) uma gravação que falhou conta como toque curto ("Mantém carregado para gravar"). */
export const MIN_VIDEO_MS = 1000;
/** Abaixo disto (ms) um vídeo que até gravou bem deita-se fora (é um toque, não um vídeo). */
export const DROP_VIDEO_MS = 400;

/**
 * O aviso curto depois de uma gravação que não deu vídeo: largou cedo demais ("Mantém carregado para gravar"), ou a
 * câmara falhou (no CameraX, por exemplo, ERROR_NO_VALID_DATA). `null` quando correu bem e o vídeo serve.
 */
export function recordingNotice(durationMs: number, failed: boolean): string | null {
  const ms = finite(durationMs) ? durationMs : 0;
  if (failed) return ms < MIN_VIDEO_MS ? 'Mantém carregado para gravar' : 'Não consegui gravar o vídeo. Tenta outra vez.';
  return ms <= DROP_VIDEO_MS ? 'Mantém carregado para gravar' : null;
}

// ———————————————————————————————————————— Vários ————————————————————————————————————————

/** Tempo de gravação: "0:07", "1:00". */
export function recTime(ms: number): string {
  const s = Math.max(0, Math.floor((finite(ms) ? ms : 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Um valor com ouvintes (para o número do zoom e o sol mudarem sem redesenhar a câmara inteira a cada movimento). */
export type ValueStore<T> = { get: () => T; set: (v: T) => void; subscribe: (fn: () => void) => () => void };
export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T) => {
      if (Object.is(v, value)) return;
      value = v;
      subs.forEach((fn) => fn());
    },
    subscribe: (fn: () => void) => {
      subs.add(fn);
      return () => { subs.delete(fn); };
    },
  };
}

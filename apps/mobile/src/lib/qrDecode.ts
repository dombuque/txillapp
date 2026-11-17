/**
 * As contas do leitor de QR, sem DOM nem React Native (testado em tests/qrDecode.test.mjs): que motor usar no site
 * (o BarcodeDetector do browser ou o jsqr) e por que pedaços de uma imagem se procura o QR.
 *
 * Numa captura de ecrã ou numa foto grande o QR pode ser pequeno: tenta-se primeiro a imagem inteira (reduzida a
 * IMAGE_MAX de lado maior), depois o meio e, por fim, nove janelas de metade do tamanho, que se sobrepõem (cada uma lida
 * da imagem original, por isso com mais píxeis por módulo do que na imagem inteira reduzida).
 */

import { t } from '@/lib/i18n';
export type QrEngine = 'native' | 'jsqr';

/** O lado maior a que se reduz uma foto antes de procurar o QR (as fotos de 12 MP pesam e não ajudam). */
export const IMAGE_MAX = 1600;
/** As imagens pequenas (um QR recortado, um ícone) aumentam até aqui: o jsqr lê melhor módulos com mais píxeis. */
export const IMAGE_MIN = 640;
/** O lado maior de cada imagem da câmara que vai para o jsqr (mais do que isto fica lento num telemóvel fraco). */
export const CAMERA_MAX = 720;
/** De quanto em quanto tempo se olha para a câmara (ms). */
export const CAMERA_EVERY_MS = 140;

/**
 * O BarcodeDetector do browser quando existe e lê QR (Chrome no Android, Safari no Mac); senão o jsqr (Safari do
 * iPhone, Firefox, Chrome no Windows, onde o BarcodeDetector não existe ou não traz formatos nenhuns).
 * `formats` null: o browser não diz (getSupportedFormats falhou); confia-se nele.
 */
export function pickQrEngine(hasDetector: boolean, formats: readonly string[] | null): QrEngine {
  if (!hasDetector) return 'jsqr';
  if (formats === null) return 'native';
  return formats.includes('qr_code') ? 'native' : 'jsqr';
}

/** Um pedaço da imagem (sx…sh, na original) e o tamanho a que se desenha (dw×dh). */
export interface ScanPass { sx: number; sy: number; sw: number; sh: number; dw: number; dh: number; name: string }

/** O tamanho a desenhar: lado maior até `max`; as pequenas sobem até `min` (no máximo 3×). */
export function fitSize(w: number, h: number, max = IMAGE_MAX, min = IMAGE_MIN): { dw: number; dh: number } {
  const long = Math.max(w, h);
  if (!(w > 0 && h > 0)) return { dw: 0, dh: 0 };
  let k = long > max ? max / long : long < min ? Math.min(min / long, 3) : 1;
  if (k <= 0) k = 1;
  return { dw: Math.max(1, Math.round(w * k)), dh: Math.max(1, Math.round(h * k)) };
}

/**
 * Por onde se procura numa imagem w×h: a inteira, o meio (70 %) e as janelas de metade (a cada quarto), sem repetir.
 * Imagens pequenas (até ~IMAGE_MIN) ficam só com a inteira: os recortes não ajudariam.
 */
export function scanPasses(w: number, h: number): ScanPass[] {
  const out: ScanPass[] = [];
  const add = (sx: number, sy: number, sw: number, sh: number, name: string, max = IMAGE_MAX) => {
    const r = { sx: Math.round(sx), sy: Math.round(sy), sw: Math.round(sw), sh: Math.round(sh) };
    if (r.sw < 1 || r.sh < 1) return;
    if (out.some((o) => o.sx === r.sx && o.sy === r.sy && o.sw === r.sw && o.sh === r.sh)) return;
    out.push({ ...r, ...fitSize(r.sw, r.sh, max), name });
  };
  add(0, 0, w, h, 'inteira');
  if (Math.max(w, h) <= IMAGE_MIN * 1.25) return out;
  add(w * 0.15, h * 0.15, w * 0.7, h * 0.7, 'meio');
  const ww = w / 2;
  const hh = h / 2;
  // Primeiro o centro e a linha do meio (é onde costuma estar o QR numa captura), depois os cantos.
  const order: [number, number][] = [[1, 1], [1, 0], [1, 2], [0, 1], [2, 1], [0, 0], [2, 0], [0, 2], [2, 2]];
  for (const [i, j] of order) add((w / 4) * i, (h / 4) * j, ww, hh, `janela ${i},${j}`, 1200);
  return out;
}

/**
 * A parte da imagem da câmara que se lê: o quadrado do meio (o visor é quadrado), até CAMERA_MAX de lado.
 * O QR a ler está quase sempre ao centro e assim o jsqr tem menos píxeis para ver.
 */
export function cameraPass(vw: number, vh: number): ScanPass | null {
  if (!(vw > 0 && vh > 0)) return null;
  const side = Math.min(vw, vh);
  const d = Math.min(side, CAMERA_MAX);
  return { sx: Math.round((vw - side) / 2), sy: Math.round((vh - side) / 2), sw: Math.round(side), sh: Math.round(side), dw: Math.round(d), dh: Math.round(d), name: 'câmara' };
}

/** O que dizer quando a imagem não tem QR nenhum que se consiga ler. */
export const NO_QR_IN_IMAGE = () => t('Não encontrei nenhum QR nesta imagem. Experimenta outra, ou recorta-a à volta do QR.');

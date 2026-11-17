/**
 * A foto do mimo no editor, como no Instagram: entra inteira (dentro da moldura 9:16, com o fundo desfocado à volta) e a
 * pessoa aumenta ou diminui com dois dedos (ou a roda do rato) e arrasta. O que se vê na moldura é o que se publica: se a
 * foto ficou inteira vai a original; senão recorta-se a parte da foto que está dentro da moldura.
 * Contas puras (sem React), testadas em tests/mimoCrop.test.mjs.
 *
 * `MimoView`: `z` é o zoom em relação à foto inteira (1 = inteira); `tx`/`ty` são o desvio do centro da foto em relação ao
 * centro da moldura, em px da moldura.
 */

export type Size = { w: number; h: number };
export type Box = { x: number; y: number; w: number; h: number };
export type MimoView = { z: number; tx: number; ty: number };

/** A forma do mimo (a do cartão do visor, lib/storyFrame.ts). */
export const MIMO_RATIO = 9 / 16;
/** O zoom máximo em relação à foto inteira; numa foto muito deitada vai pelo menos ao dobro de «preencher o ecrã». */
export const MAX_ZOOM = 4;
/** O maior JPEG recortado (o ecrã inteiro de um telemóvel a 1080p); nunca se aumenta a foto. */
export const OUT_MAX: Size = { w: 1080, h: 1920 };
/** A foto inteira, ao centro. */
export const WHOLE: MimoView = { z: 1, tx: 0, ty: 0 };
/** Abaixo disto o zoom conta como «inteira» (arredondamentos dos gestos). */
const EPS = 0.002;

const ok = (s: Size | null | undefined): s is Size => !!s && s.w > 0 && s.h > 0 && Number.isFinite(s.w) && Number.isFinite(s.h);
/** Entre lo e hi (sem -0, que nas contas é igual mas nas comparações não). */
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)) + 0;

/** A moldura 9:16 dentro do ecrã do editor (`w`×`h`), ao centro, o maior possível. Px com casas (as contas pedem a forma exata). */
export function mimoFrame(w: number, h: number): Box {
  if (!(w > 0) || !(h > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const fw = Math.min(w, h * MIMO_RATIO);
  const fh = fw / MIMO_RATIO;
  return { x: (w - fw) / 2, y: (h - fh) / 2, w: fw, h: fh };
}

/** Px da moldura por px da foto, com a foto inteira (contain). */
export function containScale(img: Size, frame: Size): number {
  return ok(img) && ok(frame) ? Math.min(frame.w / img.w, frame.h / img.h) : 1;
}

/** O zoom que faz a foto preencher a moldura (cover), em relação à foto inteira. 1 se já tiver a forma da moldura. */
export function coverZoom(img: Size, frame: Size): number {
  if (!ok(img) || !ok(frame)) return 1;
  return Math.max(frame.w / img.w, frame.h / img.h) / containScale(img, frame);
}

/** O zoom máximo: 4x, ou o dobro de preencher numa foto tão deitada que preencher já passa dos 4x. */
export function maxZoom(img: Size, frame: Size): number {
  return Math.max(MAX_ZOOM, coverZoom(img, frame) * 2);
}

/**
 * Põe a vista dentro dos limites: zoom entre inteira e o máximo; num eixo em que a foto é maior do que a moldura, não deixa
 * aparecer fundo nesse eixo; num eixo em que é menor, fica ao centro (como o visor a mostra, com o fundo desfocado).
 */
export function clampView(v: MimoView, img: Size, frame: Size): MimoView {
  if (!ok(img) || !ok(frame)) return WHOLE;
  const z = clamp(Number.isFinite(v.z) ? v.z : 1, 1, maxZoom(img, frame));
  const s = containScale(img, frame) * z;
  const lx = Math.max(0, (img.w * s - frame.w) / 2);
  const ly = Math.max(0, (img.h * s - frame.h) / 2);
  return { z, tx: clamp(Number.isFinite(v.tx) ? v.tx : 0, -lx, lx), ty: clamp(Number.isFinite(v.ty) ? v.ty : 0, -ly, ly) };
}

/** Arrastar `dx`/`dy` px da moldura. */
export function panBy(v: MimoView, dx: number, dy: number, img: Size, frame: Size): MimoView {
  return clampView({ z: v.z, tx: v.tx + dx, ty: v.ty + dy }, img, frame);
}

/**
 * Zoom para `z` com o ponto (`fx`, `fy`) da moldura parado debaixo dos dedos (ou do rato). `fx`/`fy` em px a partir do canto
 * de cima à esquerda da moldura.
 */
export function zoomAt(v: MimoView, z: number, fx: number, fy: number, img: Size, frame: Size): MimoView {
  if (!ok(img) || !ok(frame)) return WHOLE;
  const nz = clamp(z, 1, maxZoom(img, frame));
  const k = nz / (v.z || 1);
  const px = fx - frame.w / 2, py = fy - frame.h / 2;
  return clampView({ z: nz, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k }, img, frame);
}

/** Inteira? (Então publica-se a foto original.) */
export function isWhole(v: MimoView): boolean {
  return !(v.z > 1 + EPS);
}

/** «Preencher o ecrã»: a foto a cobrir a moldura, ao centro. */
export function fillView(img: Size, frame: Size): MimoView {
  return clampView({ z: coverZoom(img, frame), tx: 0, ty: 0 }, img, frame);
}

/** Duplo toque: inteira passa a preencher; qualquer outra vista volta a inteira. */
export function toggleView(v: MimoView, img: Size, frame: Size): MimoView {
  return isWhole(v) && coverZoom(img, frame) > 1 + EPS ? fillView(img, frame) : WHOLE;
}

/** Onde a foto fica desenhada na moldura (px da moldura), para a pré-visualização. */
export function shownBox(v: MimoView, img: Size, frame: Size): Box {
  const s = containScale(img, frame) * v.z;
  const w = img.w * s, h = img.h * s;
  return { x: (frame.w - w) / 2 + v.tx, y: (frame.h - h) / 2 + v.ty, w, h };
}

export type MimoCrop = {
  /** A parte da foto a guardar, em frações da largura e da altura (0..1), para não depender de como se leu a foto. */
  x: number; y: number; w: number; h: number;
  /** O tamanho do JPEG, a partir dos px da foto (`img`), até OUT_MAX e sem aumentar. */
  outW: number; outH: number;
};

/**
 * O recorte a publicar: a parte da foto dentro da moldura. null se a foto ficou inteira (vai a original).
 * Quando a foto cobre a moldura nos dois eixos o JPEG sai exatamente 9:16 (o visor mostra-o a preencher o cartão).
 */
export function mimoCrop(v: MimoView, img: Size, frame: Size, max: Size = OUT_MAX): MimoCrop | null {
  if (!ok(img) || !ok(frame)) return null;
  const c = clampView(v, img, frame);
  if (isWhole(c)) return null;
  const b = shownBox(c, img, frame);
  const x0 = clamp(-b.x / b.w, 0, 1), x1 = clamp((frame.w - b.x) / b.w, 0, 1);
  const y0 = clamp(-b.y / b.h, 0, 1), y1 = clamp((frame.h - b.y) / b.h, 0, 1);
  const w = x1 - x0, h = y1 - y0;
  if (!(w > 0) || !(h > 0)) return null;
  const cw = w * img.w, ch = h * img.h;
  const k = Math.min(1, max.w / cw, max.h / ch);
  const outH = Math.max(1, Math.round(ch * k));
  // A cobrir os dois eixos: a largura sai da altura com a forma exata da moldura (sem 1 px a mais ou a menos que o visor
  // tomasse por outra forma).
  const covers = b.w >= frame.w - 1e-6 && b.h >= frame.h - 1e-6;
  const outW = Math.max(1, covers ? Math.round(outH * (frame.w / frame.h)) : Math.round(cw * k));
  return { x: x0, y: y0, w, h, outW, outH };
}

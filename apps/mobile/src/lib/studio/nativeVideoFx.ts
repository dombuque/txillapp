/**
 * O filtro completo na pré-visualização nativa (vídeos e fotos), desenhado pela Skia — sem React (testado em
 * tests/studioNativeVideoFx.test.mjs).
 *
 * - `FX_SKSL`: o mesmo shader do site (lib/studio/renderGL.ts) passado para SkSL: a nitidez (núcleo 3×3), a matriz de cor,
 *   a vinheta (cos⁴, como o `vignette` do ffmpeg) e o grão (o mesmo `hash`, com a semente do frame). `fxUniforms` dá os
 *   números a partir de `resolveFx`, com as mesmas constantes (SHARPEN_K, VIGNETTE_ANGLE, GRAIN_AMP).
 * - `coverTransform`: o frame do vídeo (que vem sem a rotação do ficheiro) rodado e a cobrir o palco, ao centro.
 * - `androidPace` / `applePace`: o que fazer em cada frame do ecrã para o vídeo da Skia seguir o relógio do estúdio. O
 *   `useVideo` da Skia 2.14 não serve: no Android descodifica um frame por cada frame do ecrã (sem olhar para o tempo) e
 *   não tem velocidade; o `seek` salta para o keyframe anterior. Aqui o vídeo só avança quando o relógio o pede e, depois
 *   de um salto, descodifica para a frente até ao frame certo. Os tempos são em **milissegundos** (como na Skia).
 *
 * Só importa tipos (o node corre este ficheiro direto). As funções de ritmo são «worklets» (correm no fio da interface).
 */
import type { FxParams } from './effects';

/** As constantes do desenho (iguais a lib/studio/effects.ts; o teste confirma). */
export const FX_CONST = { SHARPEN_K: 0.6, VIGNETTE_ANGLE: Math.PI / 2.6, GRAIN_AMP: 0.16, FRAME_W: 1080, FPS: 30 } as const;

export const FX_SKSL = `
uniform shader image;
uniform float2 size;
uniform float px;
uniform float4 r0;
uniform float4 r1;
uniform float4 r2;
uniform float sharp;
uniform float vig;
uniform float grain;
uniform float seed;
float hash(float2 p) { return fract(sin(dot(p, float2(12.9898, 78.233)) + seed) * 43758.5453); }
half4 main(float2 xy) {
  float3 c = float3(image.eval(xy).rgb);
  if (sharp > 0.0) {
    float3 n = float3(image.eval(xy + float2(px, 0.0)).rgb) + float3(image.eval(xy - float2(px, 0.0)).rgb)
             + float3(image.eval(xy + float2(0.0, px)).rgb) + float3(image.eval(xy - float2(0.0, px)).rgb);
    c = clamp(c * (1.0 + 4.0 * sharp) - n * sharp, 0.0, 1.0);
  }
  c = clamp(float3(dot(r0.rgb, c) + r0.a, dot(r1.rgb, c) + r1.a, dot(r2.rgb, c) + r2.a), 0.0, 1.0);
  if (vig > 0.0) {
    float d = min(1.0, length(xy - size * 0.5) / length(size * 0.5));
    float k = cos(vig * d);
    k = k * k;
    c *= k * k;
  }
  if (grain > 0.0) c = clamp(c + (hash(floor(xy / px)) - 0.5) * grain, 0.0, 1.0);
  return half4(half3(c), 1.0);
}`;

export type FxUniforms = {
  size: [number, number];
  px: number;
  r0: [number, number, number, number];
  r1: [number, number, number, number];
  r2: [number, number, number, number];
  sharp: number;
  vig: number;
  grain: number;
  seed: number;
};

/**
 * Os números do shader para um palco de `w`×`h` (pontos do ecrã). `px` é um píxel do quadro de 1080 de largura medido no
 * palco: a nitidez e o grão ficam do tamanho que têm no vídeo final. A matriz 4×5 (linhas R, G e B; o alfa não conta).
 */
export function fxUniforms(p: FxParams, w: number, h: number, seed = 0): FxUniforms {
  const m = p.matrix;
  return {
    size: [w, h],
    px: Math.max(1e-3, w / FX_CONST.FRAME_W),
    r0: [m[0], m[1], m[2], m[4]],
    r1: [m[5], m[6], m[7], m[9]],
    r2: [m[10], m[11], m[12], m[14]],
    sharp: p.sharpen * FX_CONST.SHARPEN_K,
    vig: p.vignette * FX_CONST.VIGNETTE_ANGLE,
    grain: p.grain * FX_CONST.GRAIN_AMP,
    seed: seed % 97,
  };
}

/** A semente do grão no instante `ms` do clipe: muda a cada frame do vídeo final (30 por segundo), como no site. */
export function grainSeed(ms: number): number {
  'worklet';
  return Math.floor((Math.max(0, ms) * FX_CONST.FPS) / 1000 + 1e-6) % 97;
}

/** O pixel do shader em JS (para os testes compararem com `applyFxPixel` de effects.ts). `n`: os 4 vizinhos somados. */
export function shaderPixel(u: FxUniforms, rgb: readonly [number, number, number], xy: [number, number], n?: readonly [number, number, number], noise = 0): [number, number, number] {
  const cl = (x: number) => Math.min(1, Math.max(0, x));
  let c = [...rgb];
  if (u.sharp > 0 && n) c = c.map((x, i) => cl(x * (1 + 4 * u.sharp) - n[i] * u.sharp));
  const row = (r: number[]) => cl(r[0] * c[0] + r[1] * c[1] + r[2] * c[2] + r[3]);
  let o = [row(u.r0), row(u.r1), row(u.r2)];
  if (u.vig > 0) {
    const d = Math.min(1, Math.hypot(xy[0] - u.size[0] / 2, xy[1] - u.size[1] / 2) / Math.hypot(u.size[0] / 2, u.size[1] / 2));
    const k = Math.cos(u.vig * d) ** 4;
    o = o.map((x) => x * k);
  }
  if (u.grain > 0) o = o.map((x) => cl(x + noise * u.grain));
  return o as [number, number, number];
}

export type Transform = ({ translateX: number } | { translateY: number } | { rotate: number } | { scale: number })[];

/**
 * O frame `iw`×`ih` (como vem do descodificador), rodado `rot` graus (a rotação do ficheiro: os vídeos ao alto do telemóvel
 * vêm deitados com 90) e a cobrir `w`×`h`, ao centro. Para o `transform` do `ImageShader` (o primeiro é o de fora).
 */
export function coverTransform(iw: number, ih: number, rot: number, w: number, h: number): Transform {
  const r = ((Math.round(rot / 90) * 90) % 360 + 360) % 360;
  const turned = r === 90 || r === 270;
  const dw = turned ? ih : iw, dh = turned ? iw : ih;
  const s = dw > 0 && dh > 0 ? Math.max(w / dw, h / dh) : 1;
  return [{ translateX: w / 2 }, { translateY: h / 2 }, { rotate: (r * Math.PI) / 180 }, { scale: s }, { translateX: -iw / 2 }, { translateY: -ih / 2 }];
}

/** Onde o vídeo deve estar agora (ms do ficheiro): o último alvo do relógio, andado à velocidade dele desde então. */
export function wantMs(t: { src: number; rate: number; playing: boolean; stamp: number; end: number }, now: number): number {
  'worklet';
  const ms = t.src * 1000 + (t.playing ? Math.max(0, now - t.stamp) * t.rate : 0);
  return Math.max(0, Math.min(ms, t.end * 1000));
}

export interface PaceIn {
  /** Onde devia estar e onde está o último frame (ms). */
  want: number;
  cur: number;
  /** A duração de um frame do ficheiro (ms). */
  frameMs: number;
  now: number;
  lastSeekAt: number;
  lastSeekTo: number;
}
/** O passo deste frame: saltar (`seek`, ms) e/ou descodificar até `advance` frames para a frente. */
export interface Pace { seek: number | null; advance: number }

/** O tempo que se dá a um salto para o descodificador entregar o frame (antes disso o `cur` ainda é o antigo). */
export const SEEK_SETTLE_MS = 300;
/** Mais à frente do que isto, salta-se (em vez de descodificar tudo até lá). */
export const FORWARD_SEEK_MS = 2500;

/**
 * Android: o vídeo da Skia só avança quando se lhe pede um frame (`nextImage`), e cada pedido dá o frame seguinte do
 * ficheiro. Aqui decide-se quantos pedir: os que faltam até ao alvo (no máximo 4 por frame do ecrã). Para trás (ou muito à
 * frente) salta-se; o salto cai no keyframe anterior e o resto faz-se a descodificar para a frente, até ao frame certo.
 */
export function androidPace(p: PaceIn): Pace {
  'worklet';
  const half = p.frameMs * 0.5;
  const behind = p.want - p.cur;
  const settling = p.now - p.lastSeekAt < SEEK_SETTLE_MS;
  if (settling) return { seek: null, advance: behind > half ? 2 : 0 };
  if (behind < -Math.max(120, p.frameMs * 2) && (Math.abs(p.want - p.lastSeekTo) > p.frameMs || p.now - p.lastSeekAt > 1500)) return { seek: p.want, advance: 0 };
  if (behind > FORWARD_SEEK_MS && Math.abs(p.want - p.lastSeekTo) > FORWARD_SEEK_MS) return { seek: p.want, advance: 0 };
  if (behind <= half) return { seek: null, advance: 0 };
  return { seek: null, advance: Math.min(4, Math.ceil(behind / p.frameMs)) };
}

export interface ApplePaceIn extends PaceIn { playing: boolean; isPlaying: boolean }
/** O passo no iPhone: o AVPlayer toca sozinho a 1× (`play`), e corrige-se com saltos exatos; parado, salta-se para o frame. */
export function applePace(p: ApplePaceIn): { seek: number | null; play: boolean | null } {
  'worklet';
  if (p.playing) {
    if (!p.isPlaying) return { seek: p.want, play: true };
    if (Math.abs(p.want - p.cur) > 250 && p.now - p.lastSeekAt > 600) return { seek: p.want, play: null };
    return { seek: null, play: null };
  }
  const seek = Math.abs(p.want - p.cur) > Math.max(25, p.frameMs * 0.75) && p.now - p.lastSeekAt > 100 && Math.abs(p.want - p.lastSeekTo) > 8 ? p.want : null;
  return { seek, play: p.isPlaying ? false : null };
}

/**
 * Este clipe pode ir pela Skia? Ao contrário não (salta frames para trás: no Android cada salto cai num keyframe); no
 * iPhone só à velocidade normal (o vídeo da Skia não muda a velocidade do AVPlayer); no Android a partir da API 26.
 */
export function skiaVideoOk(o: { os: string; version: number | string; reverse?: boolean; speed: number; ramp?: string | null }): boolean {
  if (o.reverse) return false;
  if (o.os === 'android') return Number(o.version) >= 26;
  if (o.os === 'ios') return Math.abs(o.speed - 1) < 1e-3 && !o.ramp;
  return false;
}

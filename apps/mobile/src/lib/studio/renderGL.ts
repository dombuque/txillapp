/**
 * O desenho de um clipe com os efeitos (filtro, ajustes, nitidez, vinheta e grão) numa passagem só de WebGL, a seguir a
 * fórmula de referência de lib/studio/effects.ts (`applyFxPixel`): nitidez 3×3 → matriz de cor → vinheta cos⁴ → grão.
 * Sem WebGL (raro), cai para o canvas 2D: a matriz por um filtro SVG (`ctx.filter = url(#…)`, onde houver), a vinheta por um
 * gradiente e o grão por um padrão de ruído.
 * Só no browser (o estúdio das tchekas é da web).
 */
import { fxIsNone, GRAIN_AMP, SHARPEN_K, VIGNETTE_ANGLE, type ColorMatrix, type FxParams } from './effects';

export interface Rect { x: number; y: number; w: number; h: number }

/** O bocado da fonte (px) que cobre um retângulo w×h, centrado e com zoom (o «cover» do CSS). */
export function coverCrop(sw: number, sh: number, w: number, h: number, zoom = 1): Rect {
  const k = Math.max(w / sw, h / sh) * Math.max(1, zoom);
  const cw = Math.min(sw, w / k), ch = Math.min(sh, h / k);
  return { x: (sw - cw) / 2, y: (sh - ch) / 2, w: cw, h: ch };
}

const VS = `attribute vec2 a_pos; varying vec2 v_uv; void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec4 u_crop;
uniform vec2 u_px;
uniform vec2 u_size;
uniform mat4 u_m;
uniform vec4 u_o;
uniform float u_sharp;
uniform float u_vig;
uniform float u_grain;
uniform float u_seed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + u_seed) * 43758.5453); }
void main() {
  vec2 q = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 uv = u_crop.xy + q * u_crop.zw;
  vec3 c = texture2D(u_tex, uv).rgb;
  if (u_sharp > 0.0) {
    vec3 n = texture2D(u_tex, uv + vec2(u_px.x, 0.0)).rgb + texture2D(u_tex, uv - vec2(u_px.x, 0.0)).rgb
           + texture2D(u_tex, uv + vec2(0.0, u_px.y)).rgb + texture2D(u_tex, uv - vec2(0.0, u_px.y)).rgb;
    c = clamp(c * (1.0 + 4.0 * u_sharp) - n * u_sharp, 0.0, 1.0);
  }
  c = clamp((u_m * vec4(c, 1.0)).rgb + u_o.rgb, 0.0, 1.0);
  if (u_vig > 0.0) {
    float d = min(1.0, length((q - 0.5) * u_size) / length(u_size * 0.5));
    float k = cos(u_vig * d);
    k = k * k;
    c *= k * k;
  }
  if (u_grain > 0.0) c = clamp(c + (hash(floor(q * u_size)) - 0.5) * u_grain, 0.0, 1.0);
  gl_FragColor = vec4(c, 1.0);
}`;

/** As fotos grandes ficam com no máximo isto de lado na textura (muitos telemóveis não passam de 4096). */
const MAX_TEX = 2048;
const shrunk = new WeakMap<object, HTMLCanvasElement>();
function textureSource(src: TexImageSource & CanvasImageSource, sw: number, sh: number): { src: TexImageSource; sw: number; sh: number } {
  if (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement && Math.max(sw, sh) > MAX_TEX) {
    let c = shrunk.get(src);
    if (!c) {
      const k = MAX_TEX / Math.max(sw, sh);
      c = document.createElement('canvas');
      c.width = Math.round(sw * k);
      c.height = Math.round(sh * k);
      c.getContext('2d')?.drawImage(src, 0, 0, c.width, c.height);
      shrunk.set(src, c);
    }
    return { src: c, sw: c.width, sh: c.height };
  }
  return { src, sw, sh };
}

/** Um contexto WebGL com o shader dos efeitos, a desenhar para o próprio canvas (do tamanho pedido). */
export class FxGL {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private tex: WebGLTexture | null;
  private last: unknown = null;
  lost = false;

  private constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader'); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'programa');
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['u_tex', 'u_crop', 'u_px', 'u_size', 'u_m', 'u_o', 'u_sharp', 'u_vig', 'u_grain', 'u_seed']) this.loc[n] = gl.getUniformLocation(prog, n);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.uniform1i(this.loc.u_tex, 0);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
  }

  /** null quando o browser não tem WebGL. */
  static create(w: number, h: number): FxGL | null {
    if (typeof document === 'undefined') return null;
    try {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const gl = (c.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false, alpha: false }) as WebGLRenderingContext | null)
        ?? (c.getContext('experimental-webgl', { preserveDrawingBuffer: true }) as WebGLRenderingContext | null);
      return gl ? new FxGL(c, gl) : null;
    } catch {
      return null;
    }
  }

  /**
   * Desenha o bocado `crop` (px da fonte) de `src` em w×h com os efeitos, no canvas deste contexto. `upload: false` reaproveita
   * a textura do desenho anterior (as miniaturas dos filtros desenham o mesmo frame 16 vezes).
   */
  render(src: TexImageSource & CanvasImageSource, sw: number, sh: number, crop: Rect, p: FxParams, w: number, h: number, seed = 0, upload = true): HTMLCanvasElement | null {
    if (this.lost || !sw || !sh) return null;
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    const t = textureSource(src, sw, sh);
    const k = t.sw / sw;
    try {
      // As fotos não mudam: a textura só se volta a carregar quando a fonte é outra (os vídeos, sempre).
      const still = !(typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement);
      if (upload && !(still && this.last === t.src)) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.src); this.last = t.src; }
    } catch {
      return null; // fonte doutro sítio sem CORS, ou vídeo ainda sem frame
    }
    const cx = (crop.x * k) / t.sw, cy = (crop.y * k) / t.sh, cw = (crop.w * k) / t.sw, ch = (crop.h * k) / t.sh;
    gl.uniform4f(this.loc.u_crop, cx, cy, cw, ch);
    gl.uniform2f(this.loc.u_px, cw / w, ch / h);
    gl.uniform2f(this.loc.u_size, w, h);
    gl.uniformMatrix4fv(this.loc.u_m, false, colMajor(p.matrix));
    gl.uniform4f(this.loc.u_o, p.matrix[4], p.matrix[9], p.matrix[14], 0);
    gl.uniform1f(this.loc.u_sharp, p.sharpen * SHARPEN_K);
    gl.uniform1f(this.loc.u_vig, p.vignette * VIGNETTE_ANGLE);
    gl.uniform1f(this.loc.u_grain, p.grain * GRAIN_AMP);
    gl.uniform1f(this.loc.u_seed, seed % 97);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}

/** A matriz 4×4 (sem os deslocamentos) por colunas, como o WebGL quer. */
function colMajor(m: ColorMatrix): Float32Array {
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = m[r * 5 + c];
  return out;
}

// ---------------------------------------------------------------- sem WebGL

let svgRoot: SVGSVGElement | null = null;
const svgIds = new Map<string, string>();
/** Um filtro SVG com a matriz (para `ctx.filter = url(#id)`); null se não houver documento. */
function svgFilter(m: ColorMatrix): string | null {
  if (typeof document === 'undefined') return null;
  const key = m.map((v) => v.toFixed(4)).join(' ');
  const have = svgIds.get(key);
  if (have) return have;
  if (!svgRoot) {
    svgRoot = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgRoot.setAttribute('width', '0');
    svgRoot.setAttribute('height', '0');
    svgRoot.setAttribute('aria-hidden', 'true');
    svgRoot.style.position = 'absolute';
    document.body.appendChild(svgRoot);
  }
  if (svgIds.size > 40) { svgRoot.innerHTML = ''; svgIds.clear(); }
  const id = `txfx${svgIds.size}${Date.now().toString(36)}`;
  const f = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  f.setAttribute('id', id);
  f.setAttribute('color-interpolation-filters', 'sRGB');
  const cm = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
  cm.setAttribute('type', 'matrix');
  cm.setAttribute('values', key);
  f.appendChild(cm);
  svgRoot.appendChild(f);
  svgIds.set(key, id);
  return id;
}
let noise: HTMLCanvasElement | null = null;
function noiseTile(): HTMLCanvasElement {
  if (noise) return noise;
  noise = document.createElement('canvas');
  noise.width = noise.height = 128;
  const g = noise.getContext('2d')!;
  const d = g.createImageData(128, 128);
  for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0);
  return noise;
}
/** O mesmo desenho só com o canvas 2D (mais leve e mais aproximado). */
export function drawFx2D(g: CanvasRenderingContext2D, src: CanvasImageSource, crop: Rect, to: Rect, p: FxParams, seed = 0) {
  const ctx = g as CanvasRenderingContext2D & { filter?: string };
  const id = !fxIsNone(p) && 'filter' in ctx ? svgFilter(p.matrix) : null;
  g.save();
  g.beginPath();
  g.rect(to.x, to.y, to.w, to.h);
  g.clip();
  if (id) ctx.filter = `url(#${id})`;
  g.drawImage(src, crop.x, crop.y, crop.w, crop.h, to.x, to.y, to.w, to.h);
  if (id) ctx.filter = 'none';
  if (p.vignette > 0) {
    const cx = to.x + to.w / 2, cy = to.y + to.h / 2, R = Math.hypot(to.w, to.h) / 2;
    const grad = g.createRadialGradient(cx, cy, R * 0.25, cx, cy, R);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${Math.min(0.95, p.vignette * 0.9)})`);
    g.fillStyle = grad;
    g.fillRect(to.x, to.y, to.w, to.h);
  }
  if (p.grain > 0) {
    const pat = g.createPattern(noiseTile(), 'repeat');
    if (pat) {
      g.globalAlpha = Math.min(0.5, p.grain * 0.35);
      g.globalCompositeOperation = 'overlay';
      g.translate((seed * 37) % 128, (seed * 61) % 128);
      g.fillStyle = pat;
      g.fillRect(to.x - 128, to.y - 128, to.w + 256, to.h + 256);
    }
  }
  g.restore();
}

/**
 * Desenha `src` a cobrir `to` (com zoom) e com os efeitos: WebGL quando houver efeitos e der; sem efeitos, o drawImage
 * simples (o mais rápido). Uma fonte que já não se pode desenhar (um frame libertado, um vídeo sem dados) não pára a
 * montagem: esse frame fica como estava.
 */
export function drawClip(g: CanvasRenderingContext2D, gl: FxGL | null, src: TexImageSource & CanvasImageSource, sw: number, sh: number, to: Rect, zoom: number, p: FxParams, seed = 0, source?: { x: number; y: number; w: number; h: number }): void {
  if (!sw || !sh) return;
  // `source`: o retângulo da fonte já escolhido (o enquadramento da Montagem mágica); sem ele, cover centrado com o zoom.
  const crop = source ?? coverCrop(sw, sh, to.w, to.h, zoom);
  try {
    if (fxIsNone(p)) { g.drawImage(src, crop.x, crop.y, crop.w, crop.h, to.x, to.y, to.w, to.h); return; }
    const out = gl?.render(src, sw, sh, crop, p, Math.round(to.w), Math.round(to.h), seed);
    if (out) g.drawImage(out, to.x, to.y, to.w, to.h);
    else drawFx2D(g, src, crop, to, p, seed);
  } catch {
    /* fonte indisponível neste frame */
  }
}

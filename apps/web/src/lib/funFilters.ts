/**
 * Filtros divertidos em direto para os Zás (WebGL): deformam a imagem ou mudam-lhe o estilo antes de tirares a foto.
 * Não usam deteção de caras: as deformações são no centro do ecrã, que é onde a cara costuma estar.
 */
export interface FunFx {
  id: number;
  name: string;
}

export const FUN_FX: FunFx[] = [
  { id: 0, name: 'Normal' },
  { id: 1, name: 'Narigão' },
  { id: 2, name: 'Cabeção' },
  { id: 3, name: 'Encolhido' },
  { id: 4, name: 'Olho de peixe' },
  { id: 5, name: 'Redemoinho' },
  { id: 6, name: 'Espelho' },
  { id: 7, name: 'Caleidoscópio' },
  { id: 8, name: '4 em 1' },
  { id: 9, name: 'Pixel' },
  { id: 10, name: 'Glitch' },
  { id: 11, name: 'Banda desenhada' },
  { id: 12, name: 'Neon' },
  { id: 13, name: 'Calor' },
  { id: 14, name: 'VHS' },
];

const VERT = `attribute vec2 p; varying vec2 uv; void main(){ uv = vec2(p.x*.5+.5, 1.-(p.y*.5+.5)); gl_Position = vec4(p,0.,1.); }`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D tex; uniform float fx; uniform float t; uniform vec2 res;
varying vec2 uv;
vec3 s(vec2 q){ return texture2D(tex, clamp(q, 0.0, 1.0)).rgb; }
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float edge(vec2 q){
  vec2 px = 1.0 / res;
  float a = lum(s(q + vec2(px.x, 0.0))) - lum(s(q - vec2(px.x, 0.0)));
  float b = lum(s(q + vec2(0.0, px.y))) - lum(s(q - vec2(0.0, px.y)));
  return length(vec2(a, b));
}
void main(){
  vec2 asp = vec2(res.x / res.y, 1.0);
  vec2 c = uv - 0.5;
  vec2 d = c * asp;
  float r = length(d);
  vec2 q = uv;
  vec3 col;
  if (fx < 0.5) { col = s(uv); }
  else if (fx < 1.5) { float k = smoothstep(0.34, 0.0, r); q = 0.5 + c * (1.0 - 0.62 * k); col = s(q); }
  else if (fx < 2.5) { float k = smoothstep(0.75, 0.0, r); q = 0.5 + c * (1.0 - 0.45 * k); col = s(q); }
  else if (fx < 3.5) { float k = smoothstep(0.55, 0.0, r); q = 0.5 + c * (1.0 + 0.8 * k); col = s(q); }
  else if (fx < 4.5) { q = 0.5 + c * (0.5 + 1.15 * r * r * 2.0); col = s(q); }
  else if (fx < 5.5) { float a = 3.2 * smoothstep(0.62, 0.0, r); float cs = cos(a), sn = sin(a); vec2 e = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y); q = 0.5 + e / asp; col = s(q); }
  else if (fx < 6.5) { q.x = uv.x < 0.5 ? uv.x : 1.0 - uv.x; col = s(q); }
  else if (fx < 7.5) {
    float ang = atan(d.y, d.x) + t * 0.15;
    float seg = 6.2831853 / 6.0;
    ang = abs(mod(ang, seg) - seg * 0.5);
    q = 0.5 + vec2(cos(ang), sin(ang)) * r / asp;
    col = s(q);
  }
  else if (fx < 8.5) { q = fract(uv * 2.0); col = s(q); }
  else if (fx < 9.5) { vec2 g = vec2(44.0 * asp.x, 44.0); q = (floor(uv * g) + 0.5) / g; col = s(q); }
  else if (fx < 10.5) {
    float band = floor(uv.y * 16.0) + floor(t * 7.0);
    float h = fract(sin(band * 91.7) * 437.5);
    float off = h > 0.82 ? (h - 0.9) * 0.22 : 0.0;
    col = vec3(s(uv + vec2(off + 0.012, 0.0)).r, s(uv + vec2(off, 0.0)).g, s(uv + vec2(off - 0.012, 0.0)).b);
  }
  else if (fx < 11.5) {
    vec3 base = s(uv);
    base = floor(base * 4.0 + 0.5) / 4.0;
    float e = smoothstep(0.08, 0.28, edge(uv));
    float l = lum(base);
    col = mix(base, vec3(l), -0.35) * (1.0 - e * 0.95);
  }
  else if (fx < 12.5) {
    float e = edge(uv);
    vec3 glow = 0.5 + 0.5 * cos(6.2831853 * (t * 0.12 + uv.y * 0.6 + vec3(0.0, 0.33, 0.67)));
    col = glow * smoothstep(0.03, 0.22, e) * 2.2 + s(uv) * 0.12;
  }
  else if (fx < 13.5) {
    float l = lum(s(uv));
    vec3 c0 = vec3(0.05, 0.0, 0.35); vec3 c1 = vec3(0.7, 0.0, 0.55); vec3 c2 = vec3(1.0, 0.25, 0.0); vec3 c3 = vec3(1.0, 0.9, 0.1); vec3 c4 = vec3(1.0);
    col = l < 0.25 ? mix(c0, c1, l * 4.0) : l < 0.5 ? mix(c1, c2, (l - 0.25) * 4.0) : l < 0.75 ? mix(c2, c3, (l - 0.5) * 4.0) : mix(c3, c4, (l - 0.75) * 4.0);
  }
  else {
    float w = sin(uv.y * 70.0 + t * 9.0) * 0.003 + (fract(sin(floor(t * 3.0) * 12.9) * 43.0) > 0.85 ? sin(uv.y * 8.0 + t * 30.0) * 0.012 : 0.0);
    q = uv + vec2(w, 0.0);
    col = vec3(s(q + vec2(0.006, 0.0)).r, s(q).g, s(q - vec2(0.006, 0.0)).b);
    col *= 0.88 + 0.12 * sin(uv.y * res.y * 1.6);
    col += (fract(sin(dot(uv * t, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.08;
    col = mix(vec3(lum(col)), col, 0.85) * vec3(1.05, 1.0, 1.08);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export interface FunRenderer {
  render: (video: HTMLVideoElement, fx: number, t: number) => void;
  dispose: () => void;
}

/** Cria o desenhador no canvas; devolve null se o aparelho não tiver WebGL. */
export function createFunRenderer(canvas: HTMLCanvasElement): FunRenderer | null {
  const gl = (canvas.getContext('webgl', { preserveDrawingBuffer: true, alpha: false, antialias: false }) ?? null) as WebGLRenderingContext | null;
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const u = { fx: gl.getUniformLocation(prog, 'fx'), t: gl.getUniformLocation(prog, 't'), res: gl.getUniformLocation(prog, 'res') };
  return {
    render(video, fx, t) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      // Até 1080 de largura chega para um Zás e mantém o desenho fluido.
      const k = Math.min(1, 1080 / Math.min(w, h));
      const cw = Math.round(w * k);
      const ch = Math.round(h * k);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      gl.viewport(0, 0, cw, ch);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      gl.uniform1f(u.fx, fx);
      gl.uniform1f(u.t, t);
      gl.uniform2f(u.res, cw, ch);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    },
  };
}

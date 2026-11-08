import { FilterMode, MipmapMode, Skia, TileMode } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';

/**
 * Filtros divertidos do Zás no telemóvel (os mesmos do site): a câmara nativa não deixa deformar a imagem ao vivo, por
 * isso o filtro aplica-se à foto no momento em que é tirada, com a Skia (o mesmo desenho do shader do site).
 */
const SKSL = `
uniform shader tex;
uniform float fx;
uniform float2 res;
float3 s(float2 q) { return tex.eval(clamp(q, 0.0, 1.0) * res).rgb; }
float lum(float3 c) { return dot(c, float3(0.299, 0.587, 0.114)); }
float edge(float2 q) {
  float2 px = 1.0 / res;
  float a = lum(s(q + float2(px.x, 0.0))) - lum(s(q - float2(px.x, 0.0)));
  float b = lum(s(q + float2(0.0, px.y))) - lum(s(q - float2(0.0, px.y)));
  return length(float2(a, b));
}
half4 main(float2 fragCoord) {
  float2 uv = fragCoord / res;
  float t = 0.0;
  float2 asp = float2(res.x / res.y, 1.0);
  float2 c = uv - 0.5;
  float2 d = c * asp;
  float r = length(d);
  float2 q = uv;
  float3 col;
  if (fx < 0.5) { col = s(uv); }
  else if (fx < 1.5) { float k = smoothstep(0.34, 0.0, r); q = 0.5 + c * (1.0 - 0.62 * k); col = s(q); }
  else if (fx < 2.5) { float k = smoothstep(0.75, 0.0, r); q = 0.5 + c * (1.0 - 0.45 * k); col = s(q); }
  else if (fx < 3.5) { float k = smoothstep(0.55, 0.0, r); q = 0.5 + c * (1.0 + 0.8 * k); col = s(q); }
  else if (fx < 4.5) { q = 0.5 + c * (0.5 + 1.15 * r * r * 2.0); col = s(q); }
  else if (fx < 5.5) { float a = 3.2 * smoothstep(0.62, 0.0, r); float cs = cos(a); float sn = sin(a); float2 e = float2(cs * d.x - sn * d.y, sn * d.x + cs * d.y); q = 0.5 + e / asp; col = s(q); }
  else if (fx < 6.5) { q.x = uv.x < 0.5 ? uv.x : 1.0 - uv.x; col = s(q); }
  else if (fx < 7.5) {
    float ang = atan(d.y, d.x) + t * 0.15;
    float seg = 6.2831853 / 6.0;
    ang = abs(mod(ang, seg) - seg * 0.5);
    q = 0.5 + float2(cos(ang), sin(ang)) * r / asp;
    col = s(q);
  }
  else if (fx < 8.5) { q = fract(uv * 2.0); col = s(q); }
  else if (fx < 9.5) { float2 g = float2(44.0 * asp.x, 44.0); q = (floor(uv * g) + 0.5) / g; col = s(q); }
  else if (fx < 10.5) {
    float band = floor(uv.y * 16.0) + floor(t * 7.0);
    float h = fract(sin(band * 91.7) * 437.5);
    float off = h > 0.82 ? (h - 0.9) * 0.22 : 0.0;
    col = float3(s(uv + float2(off + 0.012, 0.0)).r, s(uv + float2(off, 0.0)).g, s(uv + float2(off - 0.012, 0.0)).b);
  }
  else if (fx < 11.5) {
    float3 base = s(uv);
    base = floor(base * 4.0 + 0.5) / 4.0;
    float e = smoothstep(0.08, 0.28, edge(uv));
    float l = lum(base);
    col = mix(base, float3(l), -0.35) * (1.0 - e * 0.95);
  }
  else if (fx < 12.5) {
    float e = edge(uv);
    float3 glow = 0.5 + 0.5 * cos(6.2831853 * (t * 0.12 + uv.y * 0.6 + float3(0.0, 0.33, 0.67)));
    col = glow * smoothstep(0.03, 0.22, e) * 2.2 + s(uv) * 0.12;
  }
  else if (fx < 13.5) {
    float l = lum(s(uv));
    float3 c0 = float3(0.05, 0.0, 0.35); float3 c1 = float3(0.7, 0.0, 0.55); float3 c2 = float3(1.0, 0.25, 0.0); float3 c3 = float3(1.0, 0.9, 0.1); float3 c4 = float3(1.0);
    col = l < 0.25 ? mix(c0, c1, l * 4.0) : l < 0.5 ? mix(c1, c2, (l - 0.25) * 4.0) : l < 0.75 ? mix(c2, c3, (l - 0.5) * 4.0) : mix(c3, c4, (l - 0.75) * 4.0);
  }
  else {
    float w = sin(uv.y * 70.0 + t * 9.0) * 0.003;
    q = uv + float2(w, 0.0);
    col = float3(s(q + float2(0.006, 0.0)).r, s(q).g, s(q - float2(0.006, 0.0)).b);
    col *= 0.88 + 0.12 * sin(uv.y * res.y * 1.6);
    col = mix(float3(lum(col)), col, 0.85) * float3(1.05, 1.0, 1.08);
  }
  return half4(half3(clamp(col, 0.0, 1.0)), 1.0);
}`;

let effect: ReturnType<typeof Skia.RuntimeEffect.Make> | null | undefined;

/** Aplica o filtro `fx` (índice de FUN_FX) à foto e devolve o ficheiro novo; com 0 (ou se falhar) devolve a foto original. */
export async function applyZasFx(uri: string, fx: number): Promise<string> {
  if (!fx) return uri;
  try {
    effect ??= Skia.RuntimeEffect.Make(SKSL);
    if (!effect) return uri;
    const data = await Skia.Data.fromURI(uri);
    const img = Skia.Image.MakeImageFromEncoded(data);
    if (!img) return uri;
    const w = img.width(), h = img.height();
    const outW = Math.min(w, 1080), outH = Math.round((h * outW) / w);
    const surface = Skia.Surface.MakeOffscreen(outW, outH) ?? Skia.Surface.Make(outW, outH);
    if (!surface) return uri;
    const m = Skia.Matrix();
    m.scale(outW / w, outH / h);
    const texture = img.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None, m);
    const paint = Skia.Paint();
    paint.setShader(effect.makeShaderWithChildren([fx, outW, outH], [texture]));
    surface.getCanvas().drawPaint(paint);
    surface.flush();
    const bytes = surface.makeImageSnapshot().encodeToBytes(3, 90); // 3 = JPEG
    const file = new File(Paths.cache, `zas-${Date.now()}.jpg`);
    file.create({ overwrite: true });
    file.write(bytes);
    return file.uri;
  } catch {
    return uri;
  }
}

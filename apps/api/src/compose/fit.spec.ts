import { createCanvas } from '@napi-rs/canvas';
import { composeClipSchema } from './compose.schema';
import { autoFit, containRect, FIT_BLUR_BRIGHTNESS, FIT_BLUR_SIGMA, FIT_COVER_MAX_ASPECT, fitGraph, resolveFit } from './fit';
import { streamRotation } from './ffmpeg';
import { KEN_BURNS } from './plan';
import { renderPhotoFrames } from './studio-canvas';

describe('o encaixe no quadro 9:16 (fit)', () => {
  it('automático: a cobrir até 0,8 de largura/altura, inteiro com o fundo desfocado acima', () => {
    expect([FIT_COVER_MAX_ASPECT, FIT_BLUR_SIGMA, FIT_BLUR_BRIGHTNESS]).toEqual([0.8, 40, 0.7]);
    expect(autoFit(1080, 1920)).toBe('cover'); // 9:16
    expect(autoFit(1440, 1920)).toBe('cover'); // 3:4 (0,75)
    expect(autoFit(800, 1000)).toBe('cover'); // 0,8 em cheio
    expect(autoFit(801, 1000)).toBe('blur');
    expect(autoFit(1080, 1080)).toBe('blur'); // quadrado
    expect(autoFit(1920, 1080)).toBe('blur'); // 16:9 deitado
    expect(autoFit(0, 0)).toBe('cover'); // sem tamanho
    expect(resolveFit('cover', 1920, 1080)).toBe('cover');
    expect(resolveFit(undefined, 1920, 1080)).toBe('blur');
  });

  it('a rotação dos metadados conta (um telemóvel de pé grava deitado com 90°)', () => {
    expect(streamRotation({ side_data_list: [{ rotation: -90 }] })).toBe(270);
    expect(streamRotation({ side_data_list: [{ rotation: 90 }] })).toBe(90);
    expect(streamRotation({ tags: { rotate: '180' } })).toBe(180);
    expect(streamRotation(undefined)).toBe(0);
  });

  it('o retângulo contido: ao centro e, com zoom, à volta do ponto pedido', () => {
    expect(containRect(1920, 1080, 1080, 1920)).toEqual({ x: 0, y: 656.25, w: 1080, h: 607.5 });
    const z = containRect(1920, 1080, 1080, 1920, 1.07);
    expect(z.w).toBeCloseTo(1155.6);
    expect(z.x + z.w / 2).toBeCloseTo(540);
    expect(z.y + z.h / 2).toBeCloseTo(960);
    const at = containRect(1000, 1000, 1000, 2000, 2, 0, 500);
    expect(at).toEqual({ x: 0, y: 500, w: 2000, h: 2000 });
  });

  it('no ffmpeg: o desfoque escala com a largura do quadro', () => {
    expect(fitGraph('blur', 540, 960, '[i]', '[o]', 't').join(';')).toContain('scale=68:120:force_original_aspect_ratio=increase:flags=area,crop=68:120,gblur=sigma=2.5:steps=3');
    expect(fitGraph('cover', 540, 960, '[i]', '[o]', 't')).toEqual(['[i]scale=540:960:force_original_aspect_ratio=increase:flags=bicubic,crop=540:960,setsar=1[o]']);
  });

  it('o pedido: `fit` é opcional, cover ou blur', () => {
    const base = { mediaId: '00000000-0000-4000-8000-000000000001', kind: 'video' };
    expect(composeClipSchema.safeParse(base).success).toBe(true);
    expect(composeClipSchema.safeParse({ ...base, fit: 'blur' }).success).toBe(true);
    const bad = composeClipSchema.safeParse({ ...base, fit: 'contain' });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0].message).toBe('O encaixe é cover ou blur');
  });
});

/** O centróide (subpíxel) do que é claro (> 200) num frame RGBA. */
function centroid(f: Uint8Array, W: number, H: number) {
  let sx = 0, sy = 0, sw = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = f[(y * W + x) * 4] - 200;
    if (v > 0) { sx += v * x; sy += v * y; sw += v; }
  }
  return { x: sx / sw, y: sy / sw };
}

describe('o Ken Burns das fotos no canvas: liso, sem saltos de píxel', () => {
  // Uma foto escura com um ponto claro perto do canto (onde o zoom mais o mexe).
  async function photo(w: number, h: number, px: number, py: number) {
    const c = createCanvas(w, h), g = c.getContext('2d');
    g.fillStyle = '#303030';
    g.fillRect(0, 0, w, h);
    const grad = g.createRadialGradient(px, py, 0, px, py, 14);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(px - 16, py - 16, 32, 32);
    return c.encode('png');
  }
  async function track(o: { image: Buffer; background?: Buffer }, W: number, H: number, N: number) {
    const pts: { x: number; y: number }[] = [];
    await renderPhotoFrames({ ...o, frames: N, W, H, fx: {}, write: async (f) => { pts.push(centroid(f, W, H)); } });
    const step = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
    const jerk = Math.max(...step.slice(1).map((s, i) => Math.abs(s - step[i])));
    return { pts, step, jerk };
  }

  it('a cobrir: o ponto afasta-se do centro um bocadinho em cada frame, sempre o mesmo (o zoompan dava 0, 1, 0, 2 px)', async () => {
    const W = 270, H = 480, N = 45;
    // A foto já cortada à proporção do quadro, 1,5× maior (como a montagem a prepara).
    const r = await track({ image: await photo(405, 720, 360, 640) }, W, H, N);
    // De 1 a 1 + 0,07·44/45 à volta do centro: o ponto (a 0,89 e 0,89 da foto) anda ~0,24 px por frame.
    const ideal = Math.hypot(240 - 135, 426.7 - 240) * KEN_BURNS / N;
    expect(Math.min(...r.step)).toBeGreaterThan(ideal * 0.8);
    expect(Math.max(...r.step)).toBeLessThan(ideal * 1.2);
    expect(r.jerk).toBeLessThan(0.1); // o arredondamento a píxeis inteiros daria saltos de ~1 px
  });

  it('inteira com o fundo desfocado: só a foto da frente aproxima, lisa', async () => {
    const W = 270, H = 480, N = 45;
    const bg = createCanvas(W, H), bgc = bg.getContext('2d');
    bgc.fillStyle = '#202020';
    bgc.fillRect(0, 0, W, H);
    const r = await track({ image: await photo(400, 300, 360, 270), background: await bg.encode('png') }, W, H, N);
    // A frente contida: 270×202,5 ao centro (y de 138,75 a 341,25); o ponto começa em (243, 321).
    expect(r.pts[0].x).toBeCloseTo(243, 0);
    expect(r.pts[0].y).toBeCloseTo(321, 0);
    expect(r.jerk).toBeLessThan(0.1); // o arredondamento a píxeis inteiros daria saltos de ~1 px
    expect(Math.min(...r.step)).toBeGreaterThan(0);
  });
});

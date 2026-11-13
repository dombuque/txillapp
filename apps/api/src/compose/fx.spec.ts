import { createCanvas } from '@napi-rs/canvas';
import { animState, fxSeconds, rampById, rampIntegral, rampAverage, sanitizeOverlay, type Overlay } from './effects';
import { mergedPieces, overlayBox, overlayRuns, rampSetpts, reverseChunks } from './fx';
import { clipArgs, finalArgs } from './plan';
import { drawOverlays, overlaySize } from './renderOverlays';
import { ensureStudioFonts } from './studio-canvas';

/** Avalia a expressão do `setpts` da rampa (gte, lt e aritmética) para um T. */
function evalSetpts(expr: string, T: number): number {
  const body = /setpts='\((.*)\)\/TB'/.exec(expr)![1];
  const js = body.replace(/gte\(T,([\d.]+)\)/g, '(T>=$1?1:0)').replace(/lt\(T,([\d.]+)\)/g, '(T<$1?1:0)');
  return new Function('T', `return ${js};`)(T) as number;
}
const ov = (o: unknown) => sanitizeOverlay(o) as Overlay;

describe('os efeitos do estúdio no servidor: as contas', () => {
  it('rampa: os bocados planos juntam-se, cobrem o corte todo e dão a duração do estúdio', () => {
    for (const id of ['montaria', 'heroi', 'bala', 'flash'] as const) {
      const fx = { ramp: id };
      const p = mergedPieces(4, 1, fx);
      const D = fxSeconds(4, 1, fx);
      expect(p[0].out0).toBe(0);
      expect(p[0].src0).toBe(0);
      expect(Math.abs(p[p.length - 1].out1 - D)).toBeLessThan(1e-3);
      expect(Math.abs(p[p.length - 1].src1 - 4)).toBeLessThan(1e-3);
      expect(p.length).toBeLessThan(Math.ceil(D / 0.1)); // menos bocados do que os de 0,1 s
      // O setpts leva cada instante da fonte ao instante do vídeo onde o estúdio o mostra (sourceOffset).
      const pts = rampById(id)!.points;
      for (const u of [0.1, 0.35, 0.5, 0.8]) {
        const src = (4 * rampIntegral(pts, u)) / rampAverage(pts);
        expect(Math.abs(evalSetpts(rampSetpts(p), src) - u * D)).toBeLessThan(0.02);
      }
    }
  });

  it('inverter: bocados do fim para o início, que cobrem o corte', () => {
    expect(reverseChunks(5, 2)).toEqual([{ from: 3, len: 2 }, { from: 1, len: 2 }, { from: 0, len: 1 }]);
    expect(reverseChunks(1.5, 2)).toEqual([{ from: 0, len: 1.5 }]);
  });

  it('as camadas: parada numa imagem só; a entrada, a saída e o ciclo em vídeo', () => {
    const t = ov({ id: 't', kind: 'text', start: 0.5, end: 4.5, x: 0.5, y: 0.4, text: 'Olá', anim: { in: 'pop', out: 'aparecer', loop: 'nenhuma', inDur: 0.45, outDur: 0.35 } });
    expect(overlayRuns(t, 300)).toEqual([{ kind: 'anim', k0: 15, k1: 28 }, { kind: 'still', k0: 29, k1: 124 }, { kind: 'anim', k0: 125, k1: 135 }]);
    expect(overlayRuns({ ...t, anim: { ...t.anim, in: 'nenhuma', out: 'nenhuma' } }, 300)).toEqual([{ kind: 'still', k0: 15, k1: 135 }]);
    // Em ciclo: a entrada e a saída em vídeo e, entre elas, um período só (pulsar: 25 frames) que o ffmpeg repete.
    expect(overlayRuns({ ...t, anim: { ...t.anim, loop: 'pulsar' } }, 300)).toEqual([{ kind: 'anim', k0: 15, k1: 28 }, { kind: 'cycle', k0: 29, k1: 124, period: 25 }, { kind: 'anim', k0: 125, k1: 135 }]);
    expect(overlayRuns({ ...t, end: 2.5, anim: { ...t.anim, loop: 'balancar' } }, 300)).toEqual([{ kind: 'anim', k0: 15, k1: 75 }]); // curto: frame a frame
    // O ciclo repete-se mesmo: o desenho no frame k e no frame k + 25 é igual (pulsar), e no k + 100 (balançar).
    for (const [loop, P] of [['pulsar', 25], ['balancar', 100]] as const) {
      const o = { ...t, end: 12, anim: { ...t.anim, loop } };
      const r = (f: ReturnType<typeof animState>) => Object.fromEntries(Object.entries(f).map(([key, v]) => [key, typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v]));
      for (const k of [40, 77]) expect(r(animState(o, (k + P) / 30))).toEqual(r(animState(o, k / 30)));
    }
    expect(overlayRuns(t, 100)).toEqual([{ kind: 'anim', k0: 15, k1: 28 }, { kind: 'still', k0: 29, k1: 99 }]); // corta no fim
    const gif = ov({ id: 'g', kind: 'sticker', start: 0, end: 2, x: 0.5, y: 0.5, sticker: { type: 'gif', id: 'abcd1234', url: 'https://media.giphy.com/media/abcd1234/giphy.gif', w: 200, h: 200 } });
    expect(overlayRuns(gif, 300)).toEqual([{ kind: 'anim', k0: 0, k1: 60 }]);
  });

  it('a caixa de cada camada tem tudo o que ela desenha (néon, pop, ondulação, subir, etiquetas)', () => {
    ensureStudioFonts();
    const W = 1080, H = 1920;
    const c = createCanvas(W, H), g = c.getContext('2d') as unknown as CanvasRenderingContext2D;
    const env = { W, H, image: () => null };
    const cases = [
      ov({ id: 'a', kind: 'text', start: 0, end: 4, x: 0.5, y: 0.4, rot: 12, text: 'Bom dia, Maputo!', font: 'futuro', size: 120, color: '#ff4fd8', neon: true, anim: { in: 'pop', out: 'brilho', loop: 'pulsar', inDur: 0.45, outDur: 0.35 } }),
      ov({ id: 'b', kind: 'text', start: 0, end: 4, x: 0.3, y: 0.7, text: 'ondas no mar\nde Inhambane', font: 'praia', size: 90, color: '#ffffff', shadow: true, outline: true, anim: { in: 'ondulacao', out: 'subir', loop: 'balancar', inDur: 1, outDur: 1 } }),
      ov({ id: 'c', kind: 'sticker', start: 0, end: 4, x: 0.6, y: 0.2, rot: -4, sticker: { type: 'location', name: 'Costa do Sol' }, variant: 'coral', anim: { in: 'subir', out: 'pop', loop: 'nenhuma', inDur: 0.4, outDur: 0.4 } }),
      ov({ id: 'd', kind: 'sticker', start: 0, end: 4, x: 0.5, y: 0.5, scale: 1.5, sticker: { type: 'time', format: 'hora-data', at: Date.UTC(2026, 10, 12, 20, 41) }, variant: 'escuro', anim: { in: 'pop', out: 'aparecer', loop: 'pulsar', inDur: 0.4, outDur: 0.4 } }),
    ];
    for (const o of cases) {
      const box = overlayBox(o, overlaySize(g, o, env))!;
      for (let t = 0; t <= 4; t += 0.1) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, W, H);
        drawOverlays(g, [o], t, env);
        const d = (g as unknown as { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } }).getImageData(0, 0, W, H).data;
        let outside = 0;
        for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
          if (d[(y * W + x) * 4 + 3] > 2 && (x < box.x || x >= box.x + box.w || y < box.y || y >= box.y + box.h)) outside++;
        }
        expect({ id: o.id, t: Math.round(t * 10) / 10, outside }).toEqual({ id: o.id, t: Math.round(t * 10) / 10, outside: 0 });
      }
    }
  });

  it('um emoji no meio de um texto sai a cores (a fonte de emojis entra quando a do estúdio não tem o glifo)', () => {
    ensureStudioFonts();
    const c = createCanvas(600, 300), g = c.getContext('2d') as unknown as CanvasRenderingContext2D;
    const o = ov({ id: 'e', kind: 'text', start: 0, end: 2, x: 0.5, y: 0.5, text: 'Bora 🔥', font: 'futuro', size: 120, color: '#ffffff', anim: { in: 'nenhuma', out: 'nenhuma', loop: 'nenhuma' } });
    g.fillStyle = "#000"; g.fillRect(0, 0, 600, 300);
    drawOverlays(g, [o], 1, { W: 600, H: 300, image: () => null });
    const d = (g as unknown as { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } }).getImageData(0, 0, 600, 300).data;
    let colored = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] - d[i + 2] > 80) colored++;
    expect(colored).toBeGreaterThan(500); // laranja do 🔥, não uma caixa branca
  });

  it('o clipe com efeitos: LUT, nitidez, vinheta, a cabeça da transição em RGBA; sem o look nem o xfade de sempre', () => {
    const args = clipArgs({
      kind: 'video', input: 'in.mp4', trimStart: 1, trimLen: 4, speed: 1, hasAudio: true, frames: 120, w: 1080, h: 1920, look: 'pb', prevStill: 'last.png', transition: 'fade',
      out: { video: 'v.mp4', audio: 'a.wav', last: 'l.png' }, fx: { filter: { id: 'gorongosa', amount: 1 }, ramp: 'heroi' }, lut: 'lut_1.cube', head: { frames: 15, file: 'head.rgba' },
    });
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain("lut3d=file='lut_1.cube':interp=trilinear");
    expect(graph).toContain('convolution=');
    expect(graph).toContain('vignette=angle=');
    expect(graph).toMatch(/vignette=angle=[\d.]+:dither=0,format=gbrp,format=yuv420p/); // a vinheta fica em RGB (serverFxChain)
    expect(graph).not.toContain('colorchannelmixer');
    expect(graph).not.toContain('xfade');
    expect(graph).toContain('trim=start_frame=15');
    expect(graph).toContain('concat=n='); // o som da rampa aos bocados
    expect(args.join(' ')).toContain('-f rawvideo -pix_fmt rgba head.rgba');
  });

  it('no grafo final, cada camada fica só entre os frames dela (pelo tempo, com meio frame de folga)', () => {
    const { graph } = finalArgs({
      seconds: 5, videoList: 'v.txt', audioList: 'a.txt', music: null, duet: null, originalVolume: 1, texts: [], out: 'o.mp4',
      overlays: [{ file: 'layer_0.mov', x: 10, y: 20, start: null, end: null, frames: { k0: 15, k1: 28, anim: true } }, { file: 'layer_1.png', x: 10, y: 20, start: null, end: null, frames: { k0: 29, k1: 124, anim: false } }],
    }, 'g.txt');
    expect(graph).toContain('setpts=PTS-STARTPTS+15/(30*TB)');
    expect(graph).toContain("eof_action=pass:enable='between(t,0.4833,0.95)'");
    expect(graph).toContain("eof_action=repeat:enable='between(t,0.95,4.15)'");
  });
});

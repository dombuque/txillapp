import { createCanvas } from '@napi-rs/canvas';
import { cardLayout, CARD_TIMES, drawEndCard, END_CARD_S, endCardSting } from '../media/end-card';
import { outSize, signedCopyGraph } from '../media/end-card-video';
import { LOGO_BOX, LOGO_INK_PATHS } from '../media/marca';
import { BOX } from '../media/signature';
import { bakeArgs, bakedMediaId, bakeMix, musicBakedOf } from './music-bake';
import { downloadVersion } from './post-download.service';

describe('fim de tcheka: as contas (sem base de dados)', () => {
  it('a mistura segue os volumes por omissão da montagem', () => {
    expect(bakeMix(false)).toEqual({ originalVolume: 1, musicVolume: 0.7, musicStartMs: 0 });
    // «Usar este som»: o som do vídeo começa calado e o som entra a 100 %.
    expect(bakeMix(true)).toEqual({ originalVolume: 0, musicVolume: 1, musicStartMs: 0 });
  });

  it('bakeArgs: a imagem copia-se, a música em ciclo desde o trecho, amix sem normalizar e o limitador', () => {
    const args = bakeArgs({ video: 'in.mp4', music: 'm', seconds: 12.5, hasAudio: true, originalVolume: 1, musicVolume: 0.7, musicStartMs: 3000, out: 'out.mp4' });
    const g = args[args.indexOf('-filter_complex') + 1];
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'copy', '-map', '0:v:0', '-map', '[aout]', '-t', '12.5']));
    expect(args.slice(args.indexOf('-stream_loop'), args.indexOf('-stream_loop') + 2)).toEqual(['-stream_loop', '-1']);
    expect(g).toContain('[1:a]atrim=3:15.5');
    expect(g).toContain('volume=0.7');
    expect(g).toContain('[0:a]asetpts=PTS-STARTPTS');
    expect(g).toContain('amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.97:level=0[aout]');
    // Só as entradas de ficheiros e os formatos conhecidos.
    expect(args.filter((a) => a === '-protocol_whitelist')).toHaveLength(2);
    // Vídeo mudo (ou som calado): só a música.
    const mute = bakeArgs({ video: 'in.mp4', music: 'm', seconds: 4, hasAudio: false, originalVolume: 1, musicVolume: 1, musicStartMs: 0, out: 'o.mp4' });
    expect(mute[mute.indexOf('-filter_complex') + 1]).toMatch(/\[am\]anull\[aout\]$/);
    const quiet = bakeArgs({ video: 'in.mp4', music: 'm', seconds: 4, hasAudio: true, originalVolume: 0, musicVolume: 1, musicStartMs: 0, out: 'o.mp4' });
    expect(quiet[quiet.indexOf('-filter_complex') + 1]).not.toContain('[0:a]');
  });

  it('o vídeo da publicação: o com a música só quando vale e é este', () => {
    expect(bakedMediaId('a', { bake_source: 'a', bake_media: 'b' })).toBe('b');
    expect(bakedMediaId('a', { bake_source: 'x', bake_media: 'b' })).toBe('a');
    expect(bakedMediaId('a', { bake_source: 'a', bake_media: null })).toBe('a');
    expect(musicBakedOf({ bake_status: 'inline' })).toBe(true);
    expect(musicBakedOf({ bake_status: 'done', bake_media: 'b' })).toBe(true);
    expect(musicBakedOf({ bake_status: 'done', bake_media: null })).toBe(false);
    expect(musicBakedOf({ bake_status: 'queued' })).toBe(false);
    expect(musicBakedOf({})).toBe(false);
  });

  it('o logótipo (formas cheias): a assinatura usa a caixa do desenho e o cartão revela as letras da esquerda para a direita', () => {
    expect(BOX).toEqual({ ...LOGO_BOX });
    expect(LOGO_INK_PATHS.length).toBeGreaterThan(0);
    // A animação acaba no mesmo tempo de antes (as oito letras a 0,075 s umas das outras, 0,42 s cada).
    expect(CARD_TIMES.draw + CARD_TIMES.reveal).toBeCloseTo(0.16 + 7 * 0.075 + 0.42, 9);
    const W = 360, H = 640;
    const L = cardLayout(W, H);
    const c = createCanvas(W, H);
    const g = c.getContext('2d');
    // O mais claro de uma faixa vertical do logótipo (de a a b, em fração da largura).
    const band = (a: number, b: number) => {
      const d = g.getImageData(Math.round(L.x0 + L.ww * a), Math.round(L.y0), Math.round(L.ww * (b - a)), Math.round(L.wh)).data;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) max = Math.max(max, Math.min(d[i], d[i + 1], d[i + 2]));
      return max;
    };
    const opts = { label: 'teste', handle: true, seal: null };
    drawEndCard(g, W, H, CARD_TIMES.draw, opts);
    expect(band(0, 1)).toBeLessThan(120);
    drawEndCard(g, W, H, CARD_TIMES.draw + CARD_TIMES.reveal / 2, opts);
    expect(band(0, 0.3)).toBeGreaterThan(200);
    expect(band(0.75, 1)).toBeLessThan(120);
    drawEndCard(g, W, H, END_CARD_S - 0.05, opts);
    expect(band(0, 0.3)).toBeGreaterThan(200);
    expect(band(0.75, 1)).toBeGreaterThan(200);
  });

  it('o cartão: o mesmo desenho em vertical e na horizontal, a animação dentro do tempo e o som do tamanho certo', () => {
    const v = cardLayout(1080, 1920);
    expect(v.ww).toBeCloseTo(648);
    expect(v.userBaseline).toBeLessThan(v.siteY);
    const h = cardLayout(1920, 1080);
    expect(h.ww).toBeCloseTo(648);
    expect(h.siteY).toBeLessThan(1080);
    expect(CARD_TIMES.site + 0.5).toBeLessThan(END_CARD_S);
    const wav = endCardSting();
    expect(Buffer.from(wav.subarray(0, 4)).toString('ascii')).toBe('RIFF');
    expect(wav.length).toBe(44 + Math.round(END_CARD_S * 48_000) * 2 * 2);
  });

  it('a cópia: lados pares, no máximo 1920, e o grafo junta o vídeo (a escurecer) e o cartão', () => {
    expect(outSize(1080, 1920)).toEqual({ W: 1080, H: 1920 });
    expect(outSize(2160, 3840)).toEqual({ W: 1080, H: 1920 });
    expect(outSize(721, 1281)).toEqual({ W: 722, H: 1282 });
    const g = signedCopyGraph({ W: 720, H: 1280, seconds: 10, hasAudio: true, sign: true, mute: false });
    expect(g).toContain('[vs][3:v]overlay=0:0');
    expect(g).toContain('fade=t=out:st=9.700:d=0.300');
    expect(g).toContain('[v0][v1]concat=n=2:v=1:a=0[vout]');
    expect(g).toContain('adelay=delays=10000:all=1');
    expect(g).toContain('afade=t=out:st=9.400:d=0.600');
    expect(g).toContain(`atrim=end=${(10 + END_CARD_S).toFixed(3)}`);
    // Já assinado (câmara, montagem) ou com o som tirado: sem segunda assinatura / sem o som do vídeo.
    const signed = signedCopyGraph({ W: 720, H: 1280, seconds: 10, hasAudio: true, sign: false, mute: true });
    expect(signed).not.toContain('[3:v]');
    expect(signed).not.toContain('[0:a]');
  });

  it('a versão da cópia muda com o vídeo, o tamanho do ficheiro, o @ e o selo', () => {
    const base = { sourceId: 'm1', sourceSize: 100, label: 'ana', handle: true, seal: null, signed: false, mute: false } as const;
    const v = downloadVersion(base);
    expect(v).toMatch(/^[0-9a-f]{32}$/);
    expect(downloadVersion(base)).toBe(v);
    for (const change of [{ sourceId: 'm2' }, { sourceSize: 99 }, { label: 'ana2' }, { seal: 'verified' as const }, { mute: true }, { signed: true }]) {
      expect(downloadVersion({ ...base, ...change })).not.toBe(v);
    }
  });
});

import { lookFilter, LOOKS } from './looks';
import { alphaExpr, atempo, cleanText, clipArgs, DUCK_SC, DUET, finalArgs, frameSlots, SPF, textFilters, transitionSeconds, voiceFxGraph, wrapText } from './plan';

describe('montagem: as contas sem ffmpeg', () => {
  it('a grelha de frames não escorrega com os arredondamentos e corta nos 60 s', () => {
    const s = frameSlots([1 / 3, 1 / 3, 1 / 3, 1], 60);
    expect(s.map((x) => x.frames)).toEqual([10, 10, 10, 30]);
    expect(s.map((x) => x.start)).toEqual([0, 10, 20, 30]);
    const long = frameSlots([40, 30, 5], 60);
    expect(long.map((x) => x.frames)).toEqual([1200, 600, 0]);
    expect(frameSlots([0.71, 0.71, 0.71], 60).reduce((n, x) => n + x.frames, 0)).toBe(64); // 2,13 s
  });

  it('atempo: 0,5× a 3× (o ffmpeg só aceita 0,5 a 2 por filtro)', () => {
    expect(atempo(1)).toBe('');
    expect(atempo(2)).toBe('atempo=2');
    expect(atempo(0.5)).toBe('atempo=0.5');
    expect(atempo(3)).toBe('atempo=2,atempo=1.5');
  });

  it('o texto: sem emojis, partido em linhas (até 4), a entrar e a sair como no estúdio', () => {
    expect(cleanText('  Bora 🔥 malta\u200d!  ')).toBe('Bora malta!');
    expect(cleanText('Olá\n\n  mundo')).toBe('Olá\n\nmundo');
    const lines = wrapText('uma frase bastante comprida para caber numa linha só do vídeo', 74, 880);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.length <= Math.floor(880 / (74 * 0.64)))).toBe(true);
    expect(wrapText('a b c d e f g h i j k l m n o p q r s t u v w x y z '.repeat(8), 74, 300).length).toBe(4);
    expect(alphaExpr(1, 3)).toBe('min((1-pow(1-clip((t-1)/0.45,0,1),3)),if(gt(t,2.6),pow(1-clip((t-2.6)/0.4,0,1),3),1))');
    const t = textFilters([{ text: 'Olá malta', color: '#ffffff', bg: null, x: 0.5, y: 0.62, size: 0.068, start: 0, end: 4 }], 1080, 1920, 'font.ttf', (i, j) => `t${i}_${j}.txt`);
    expect(t.files).toEqual([{ name: 't0_0.txt', text: 'Olá malta' }]);
    expect(t.filters[0]).toMatch(/^drawtext=fontfile=font\.ttf:textfile=t0_0\.txt:expansion=none:fontsize=73:fontcolor=#ffffff/);
    expect(t.filters[0]).toContain("enable='between(t,0,4)'");
  });

  it('os filtros: os mesmos ids do estúdio; o Normal não mexe', () => {
    expect(LOOKS.map((l) => l.id)).toEqual(['normal', 'vivo', 'quente', 'fresco', 'suave', 'dourado', 'fade', 'txilla', 'vintage', 'pb']);
    expect(lookFilter('normal')).toBe('');
    expect(lookFilter(null)).toBe('');
    expect(lookFilter('pb')).toMatch(/^format=rgba,colorchannelmixer=rr=0\.2/);
  });

  it('um clipe: corte, velocidade, transição a partir do último frame do anterior, som com as amostras certas', () => {
    const a = clipArgs({ kind: 'video', input: 'in.mp4', trimStart: 1, trimLen: 4, speed: 2, hasAudio: true, frames: 60, w: 1080, h: 1920, look: null, prevStill: 'last_0.png', transition: 'slide', out: { video: 's.mp4', audio: 's.wav', last: 'l.png' } });
    const g = a[a.indexOf('-filter_complex') + 1];
    expect(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 4)).toEqual(['-ss', '1', '-t', '4']);
    expect(g).toContain('setpts=(PTS-STARTPTS)/2');
    expect(g).toContain('xfade=transition=slideleft:duration=0.5:offset=0');
    expect(g).toContain('atempo=2');
    expect(g).toContain(`atrim=end_sample=${60 * SPF}`);
    expect(g).toContain("select='eq(n,59)'");
    const cut = clipArgs({ kind: 'photo', input: 'p.jpg', trimStart: 0, trimLen: 0, speed: 1, hasAudio: false, frames: 90, w: 540, h: 960, look: 'quente', prevStill: 'last_0.png', transition: 'cut', out: { video: 's.mp4', audio: 's.wav', last: 'l.png' } });
    const gc = cut[cut.indexOf('-filter_complex') + 1];
    expect(gc).not.toContain('xfade');
    expect(gc).toContain("zoompan=z='1+0.07*on/90'");
    expect(gc).toContain('s=540x960');
    expect(cut).toContain('anullsrc=r=48000:cl=stereo');
    expect(transitionSeconds(10)).toBeCloseTo(0.3);
  });

  it('o grafo final: dueto lado a lado (quadros 9:16 ao meio), assinatura por cima e a mistura do som', () => {
    expect(DUET).toEqual({ w: 540, h: 960, y: 480 });
    const f = finalArgs({
      seconds: 4, videoList: 'v.txt', audioList: 'a.txt', music: { file: 'm.bin', volume: 0.8 }, duet: { file: 'd.mp4', hasAudio: true, volume: 1 },
      originalVolume: 0.4, texts: [], overlays: [{ file: 'sign.png', x: 800, y: 1700, start: null, end: null }, { file: 'st.png', x: 10, y: 20, start: 1, end: 2 }], out: 'o.mp4',
    }, 'graph.txt');
    expect(f.graph).toContain('[bg][me]overlay=0:480');
    expect(f.graph).toContain('[d1][or]overlay=540:480');
    expect(f.graph).toContain("overlay=10:20:format=auto:enable='between(t,1,2)'");
    expect(f.graph).toContain('amix=inputs=3:duration=first:dropout_transition=0:normalize=0');
    expect(f.args).toEqual(expect.arrayContaining(['-stream_loop', '-1', '-movflags', '+faststart', '-filter_complex_script', 'graph.txt']));
    expect(f.args.slice(f.args.indexOf('-t'), f.args.indexOf('-t') + 2)).toEqual(['-t', '4']);
  });

  it('o som do estúdio: o trecho, os fades, a voz-off com ducking, os efeitos sonoros e o Estádio', () => {
    const f = finalArgs({
      seconds: 6, videoList: 'v.txt', audioList: 'a.txt', music: { file: 'm.bin', volume: 0.8, startS: 42.5, fadeIn: 1.5, fadeOut: 2 }, duet: null,
      originalVolume: 0.4, originalFx: 'estadio', voice: { file: 'voice.bin', startS: 1.25, volume: 0.9, fx: 'esquilo', duck: true }, sfx: { file: 'sfx.wav', volume: 0.7 }, irFile: 'ir.wav',
      texts: [], overlays: [], out: 'o.mp4',
    }, 'graph.txt');
    // As entradas: vídeos, sons, música, voz, efeitos e a resposta ao impulso (só para o original, que tem o Estádio).
    const files = f.args.filter((_, i) => f.args[i - 1] === '-i');
    expect(files).toEqual(['v.txt', 'a.txt', 'm.bin', 'voice.bin', 'sfx.wav', 'ir.wav']);
    expect(f.graph).toContain('[2:a]atrim=42.5:48.5,asetpts=PTS-STARTPTS');
    expect(f.graph).toContain('afade=t=in:st=0:d=1.5,afade=t=out:st=4:d=2,volume=0.8[am_dry]');
    expect(f.graph).toContain(`[am_dry][av_sc]sidechaincompress=${DUCK_SC}[am]`);
    expect(f.graph).toContain('asetrate=72000,aresample=48000,atempo=0.666667[av_fx]');
    expect(f.graph).toContain('[av_fx]adelay=delays=1250:all=1,apad,atrim=end=6,asplit=2[av_raw][av_sc]');
    expect(f.graph).toContain('[av_raw]volume=0.9[av]');
    expect(f.graph).toContain('[4:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.7,apad,atrim=end=6[ae]');
    expect(f.graph).toContain('[ofx_w][5:a]afir=dry=1:wet=1:gtype=-1:irgain=1,volume=0.6[ofx_r]');
    expect(f.graph).toContain('[ao][av][am][ae]amix=inputs=4');
    // Sem nada disto, o som fica como antes (sem fades, sem ducking, o original sem efeito).
    const plain = finalArgs({ seconds: 4, videoList: 'v.txt', audioList: 'a.txt', music: { file: 'm.bin', volume: 1 }, duet: null, originalVolume: 1, texts: [], overlays: [], out: 'o.mp4' }, 'g.txt');
    expect(plain.graph).toContain('[2:a]atrim=0:4,asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=1[am]');
    expect(plain.graph).toContain('[ao_in]anull[ao_fx]');
    expect(plain.graph).not.toContain('afade');
    expect(plain.graph).not.toContain('sidechaincompress');
  });

  it('os efeitos de voz em filtros do ffmpeg, com os números do estúdio', () => {
    expect(voiceFxGraph('normal', '[i]', '[o]', 'x', null)).toEqual(['[i]anull[o]']);
    expect(voiceFxGraph('robo', '[i]', '[o]', 'x', null)[0]).toBe("[i]aeval=exprs='val(0)*sin(2*PI*60*t)|val(1)*sin(2*PI*60*t)':c=same,aecho=1:1:6|12|18|24:0.45|0.2025|0.0911|0.041[o]");
    expect(voiceFxGraph('grave', '[i]', '[o]', 'x', null)[0]).toBe('[i]asetrate=34560,aresample=48000,atempo=1.388889[o]');
    expect(voiceFxGraph('eco', '[i]', '[o]', 'x', null)[0]).toBe('[i]aecho=1:1:280|560|840|1120:0.6|0.27|0.1215|0.0547[o]');
    expect(voiceFxGraph('radio', '[i]', '[o]', 'x', null)[0]).toBe("[i]highpass=f=500,lowpass=f=3200,equalizer=f=1500:t=q:w=1:g=6,aeval=exprs='tanh(2.5*val(0))/tanh(2.5)|tanh(2.5*val(1))/tanh(2.5)':c=same[o]");
    expect(voiceFxGraph('estadio', '[i]', '[o]', 'x', '[9:a]')).toHaveLength(4);
    expect(() => voiceFxGraph('estadio', '[i]', '[o]', 'x', null)).toThrow();
  });
});

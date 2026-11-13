import { createElement, useEffect, useRef, type ReactNode } from 'react';
import { Image, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { coverRect, type MagicClip, type MagicResult, type MagicText } from '@/lib/studio/magic';
import { drawCapulanaFrame, drawCapulanaText, drawCapulanaTransition } from '@/lib/studio/capulanaRender';
import { isCapulanaTransition } from '@/lib/studio/capulanaShapes';

const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;
const W = 540, H = 960;

/** Os filtros das ondas em CSS (só para esta pré-visualização: o filtro a sério é o do estúdio, pelo `fx.filter`). */
const CSS_FILTER: Record<string, string> = {
  'costa-do-sol': 'saturate(1.25) sepia(0.22) brightness(1.05)',
  'noite-de-maputo': 'contrast(1.2) saturate(1.2) hue-rotate(-12deg) brightness(0.95)',
  tofo: 'saturate(1.25) hue-rotate(-8deg) contrast(1.06)',
  xima: 'brightness(1.08) contrast(0.92) saturate(0.82) sepia(0.1)',
  txillapp: 'saturate(1.12) contrast(1.06)',
  marrabenta: 'saturate(1.5) contrast(1.14)',
};
const FONT: Record<string, string> = {
  elegante: 'italic 700 {s}px TxPlayfair, "Playfair Display", Georgia, serif', futuro: '800 {s}px TxOrbitron, "Segoe UI", system-ui, sans-serif',
  praia: '400 {s}px TxPacifico, "Brush Script MT", cursive', marcador: '400 {s}px TxMarker, "Comic Sans MS", system-ui, sans-serif', retro: '400 {s}px TxLobster, Georgia, serif',
};
const fontOf = (id: string, size: number) => (FONT[id] ?? '800 {s}px TxInter, Inter, system-ui, sans-serif').replace('{s}', String(Math.round(size)));
const ease = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

type G = CanvasRenderingContext2D;
type Layer = { c: HTMLCanvasElement; g: G };

/** As transições do effects.ts em versão curta (a pré-visualização mostra o corte e o movimento; o estúdio tem as completas). */
function drawPlain(g: G, prev: CanvasImageSource, cur: CanvasImageSource, type: string, p: number) {
  const e = ease(p), bell = Math.sin(Math.PI * Math.max(0, Math.min(1, p)));
  const at = (src: CanvasImageSource, dx: number, dy: number, alpha = 1, scale = 1) => {
    g.save();
    g.globalAlpha = alpha;
    g.translate(W / 2 + dx, H / 2 + dy);
    g.scale(scale, scale);
    g.drawImage(src, -W / 2, -H / 2, W, H);
    g.restore();
  };
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  switch (type) {
    case 'deslizar-esquerda': at(prev, -W * e, 0); at(cur, W * (1 - e), 0); break;
    case 'deslizar-direita': at(prev, W * e, 0); at(cur, -W * (1 - e), 0); break;
    case 'deslizar-cima': at(prev, 0, -H * e); at(cur, 0, H * (1 - e)); break;
    case 'deslizar-baixo': at(prev, 0, H * e); at(cur, 0, -H * (1 - e)); break;
    case 'zoom': at(cur, 0, 0, 1, 1.4 - 0.4 * e); at(prev, 0, 0, 1 - Math.min(1, e * 1.25), 1 + 1.2 * e); break;
    case 'flash': at(p < 0.5 ? prev : cur, 0, 0); g.globalAlpha = Math.pow(bell, 1.6); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; break;
    case 'glitch': at(p < 0.5 ? prev : cur, (Math.round(p * 14) % 2 ? 1 : -1) * 18 * bell, 0); at(p < 0.5 ? cur : prev, 0, 0, 0.35 * bell); break;
    case 'girar': at(p < 0.5 ? prev : cur, 0, 0, 1, 1 + 0.5 * bell); break;
    default: at(cur, 0, 0); at(prev, 0, 0, 1 - e);
  }
}

/**
 * A pré-visualização da montagem mágica (web: um canvas pequeno a tocar em ciclo, com a música). Mostra os cortes ao ritmo,
 * o zoom das fotos apontado ao ponto de interesse, as molduras, as transições (também as de capulana) e o texto de abertura.
 * No nativo mostra a primeira foto (a pré-visualização a tocar é a do estúdio, depois de «Afinar»).
 */
export function MagicPreview({ result, playing, musicUrl, onClip, style }: { result: MagicResult; playing: boolean; musicUrl?: string | null; onClip?: (index: number) => void; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const live = useRef({ playing, onClip });
  live.current = { playing, onClip };

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const cv = ref.current;
    const g = cv?.getContext('2d');
    if (!cv || !g || !result.clips.length) return;
    const total = Math.max(0.1, result.total);
    const imgs = new Map<string, HTMLImageElement>(), vids = new Map<string, HTMLVideoElement>();
    for (const c of result.clips) {
      if (c.video) {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = c.uri;
        vids.set(c.key, v);
      } else { const im = document.createElement('img'); im.src = c.uri; imgs.set(c.key, im); }
    }
    const layers = new Map<string, Layer>();
    const layer = (name: string, w: number, h: number): Layer | null => {
      let l = layers.get(name);
      if (!l) { const c = document.createElement('canvas'); const x = c.getContext('2d'); if (!x) return null; l = { c, g: x }; layers.set(name, l); }
      if (l.c.width !== w || l.c.height !== h) { l.c.width = w; l.c.height = h; }
      return l;
    };
    const prev = layer('prev', W, H), cur = layer('cur', W, H);
    const audio = musicUrl ? new Audio(musicUrl) : null;
    if (audio) audio.preload = 'auto';
    const musicAt = (result.music?.startMs ?? 0) / 1000;

    function base(x: G, c: MagicClip, tl: number, dur: number) {
      x.fillStyle = '#000';
      x.fillRect(0, 0, W, H);
      const css = c.fx?.filter ? CSS_FILTER[c.fx.filter.id] : undefined;
      if (c.video) {
        const v = vids.get(c.key);
        if (!v || v.readyState < 2) return;
        const r = coverRect(v.videoWidth, v.videoHeight, { x: c.fx?.focus?.x ?? 0.5, y: c.fx?.focus?.y ?? 0.5, from: 1, to: 1 }, 0, W, H);
        if (css) x.filter = css;
        x.drawImage(v, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);
        x.filter = 'none';
        return;
      }
      const im = imgs.get(c.key);
      if (!im || !im.naturalWidth) return;
      const f = c.fx?.focus ?? { x: 0.5, y: 0.5, from: 1, to: 1.07 };
      const u = Math.min(1, tl / Math.max(0.1, dur));
      if (c.fx?.moldura) { drawCapulanaFrame(x, im, im.naturalWidth, im.naturalHeight, W, H, c.fx.moldura, f.from + (f.to - f.from) * u, f); return; }
      const r = coverRect(im.naturalWidth, im.naturalHeight, f, u, W, H);
      if (css) x.filter = css;
      x.drawImage(im, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);
      x.filter = 'none';
    }
    function text(x: G, o: MagicText, t: number) {
      if (t < o.start || t > o.end) return;
      const a = Math.min(1, (t - o.start) / Math.max(0.05, o.anim.inDur), (o.end - t) / Math.max(0.05, o.anim.outDur));
      const size = (o.size * W) / 1080;
      const pop = o.anim.in === 'pop' ? 0.8 + 0.2 * ease(Math.min(1, (t - o.start) / Math.max(0.05, o.anim.inDur))) : 1;
      // Parte o texto em linhas que caibam em 80 % da largura.
      x.save();
      x.font = fontOf(o.font, size);
      const lines: string[] = [];
      for (const word of o.text.split(/\s+/)) {
        const last = lines[lines.length - 1];
        if (last != null && x.measureText(`${last} ${word}`).width <= W * 0.8) lines[lines.length - 1] = `${last} ${word}`; else lines.push(word);
      }
      x.restore();
      const cx = o.x * W, cy = o.y * H;
      if (o.pano) { drawCapulanaText(x, lines.join('\n'), o.pano, { x: cx, y: cy, size: size * pop, font: fontOf(o.font, size * pop), scratch: layer, alpha: a }); return; }
      x.save();
      x.globalAlpha = a;
      x.font = fontOf(o.font, size * pop);
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.shadowColor = o.neon ? o.color : 'rgba(0,0,0,0.65)';
      x.shadowBlur = o.neon ? 22 : 14;
      x.shadowOffsetY = o.neon ? 0 : 3;
      x.fillStyle = o.neon ? '#ffffff' : o.color;
      x.lineJoin = 'round';
      x.lineWidth = size * 0.1;
      x.strokeStyle = 'rgba(0,0,0,0.38)';
      lines.forEach((l, i) => { const y = cy + (i - (lines.length - 1) / 2) * size * 1.15; if (!o.neon) x.strokeText(l, cx, y); x.fillText(l, cx, y); });
      x.restore();
    }

    let raf = 0, at = 0, stamp = performance.now(), index = -1, hasPrev = false, wasPlaying = false;
    const stopMedia = () => { vids.forEach((v) => { try { v.pause(); } catch { /* nada */ } }); try { audio?.pause(); } catch { /* nada */ } };
    function frame() {
      raf = requestAnimationFrame(frame);
      if (!g || !cv) return;
      const now = performance.now();
      const on = live.current.playing;
      if (on) at += (now - stamp) / 1000;
      stamp = now;
      if (on !== wasPlaying) {
        wasPlaying = on;
        if (!on) stopMedia();
        else if (audio) { try { audio.currentTime = musicAt + at; void audio.play().catch(() => undefined); } catch { /* sem som */ } }
      }
      if (at >= total) { at = 0; index = -1; hasPrev = false; if (audio && on) { try { audio.currentTime = musicAt; void audio.play().catch(() => undefined); } catch { /* sem som */ } } }
      let i = result.clips.length - 1;
      for (let k = 0; k < result.clips.length; k++) if (at < result.starts[k] + result.durations[k]) { i = k; break; }
      const c = result.clips[i], dur = result.durations[i], tl = Math.max(0, at - result.starts[i]);
      if (i !== index) {
        if (index >= 0 && i === index + 1 && prev) { prev.g.drawImage(cv, 0, 0, W, H); hasPrev = true; } else hasPrev = false;
        vids.forEach((v, key) => { if (key !== c.key) { try { v.pause(); } catch { /* nada */ } } });
        index = i;
        live.current.onClip?.(i);
      }
      if (c.video) {
        const v = vids.get(c.key);
        if (v) {
          const rate = Math.max(0.25, Math.min(4, (c.trim.end - c.trim.start) / Math.max(0.1, dur)));
          const want = c.trim.start + tl * rate;
          if (Math.abs(v.currentTime - want) > 0.4) { try { v.currentTime = want; } catch { /* ainda não dá */ } }
          if (v.playbackRate !== rate) v.playbackRate = rate;
          if (on && v.paused) void v.play().catch(() => undefined);
        }
      }
      const tr = i > 0 ? c.fx?.transition : undefined;
      if (tr && tr.type !== 'corte' && tl < tr.dur && hasPrev && prev && cur) {
        base(cur.g, c, tl, dur);
        const p = tl / tr.dur;
        if (isCapulanaTransition(tr.type)) drawCapulanaTransition(g, prev.c, cur.c, tr.type, p, W, H, tr.pano ?? result.pano);
        else drawPlain(g, prev.c, cur.c, tr.type, p);
      } else base(g, c, tl, dur);
      for (const o of result.overlays) text(g, o, at);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      stopMedia();
      vids.forEach((v) => { try { v.removeAttribute('src'); v.load(); } catch { /* já foi */ } });
      if (audio) { try { audio.removeAttribute('src'); audio.load(); } catch { /* já foi */ } }
    };
  }, [result, musicUrl]);

  if (Platform.OS !== 'web') {
    const first = result.clips.find((c) => !c.video);
    return <View style={[st.box, style]}>{first ? <Image source={{ uri: first.uri }} resizeMode="cover" style={StyleSheet.absoluteFill} /> : null}</View>;
  }
  return (
    <View style={[st.box, style]}>
      {dom('canvas', { ref: (el: HTMLCanvasElement | null) => { ref.current = el; }, width: W, height: H, 'aria-label': 'Pré-visualização da montagem', style: { width: '100%', height: '100%', display: 'block', backgroundColor: '#000' } })}
    </View>
  );
}

const st = StyleSheet.create({ box: { aspectRatio: 9 / 16, backgroundColor: '#000', overflow: 'hidden' } });

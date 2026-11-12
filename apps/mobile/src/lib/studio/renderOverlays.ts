/**
 * O desenho das camadas por cima da tcheka (texto e stickers) num canvas 2D de WÃ—H, no instante `t`, com as animaÃ§Ãµes de
 * lib/studio/effects.ts (`animState`). NÃ£o usa o DOM: as imagens (stickers do Txillapp e GIFs) chegam por `env.image`, por
 * isso o mesmo cÃ³digo corre num canvas do Node (por exemplo @napi-rs/canvas) se o servidor quiser as camadas iguais.
 */
import {
  animState, contrastOn, fontById, fontCss, timeLabel, visibleChars, waveOffset,
  type AnimFrame, type Overlay, type StickerOverlay, type TextOverlay,
} from './effects';

type Ctx = CanvasRenderingContext2D;
export interface OverlayEnv {
  W: number;
  H: number;
  /** A imagem de um sticker (Txillapp ou GIF) jÃ¡ carregada, ou null (ainda nÃ£o chegou: nÃ£o se desenha). */
  image: (o: StickerOverlay) => { img: CanvasImageSource; w: number; h: number } | null;
}
/** Onde ficou uma camada (px do quadro): centro, tamanho jÃ¡ com a escala dela (sem a animaÃ§Ã£o) e rotaÃ§Ã£o em graus. */
export interface OverlayBox { id: string; cx: number; cy: number; w: number; h: number; rot: number }

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';
const LABEL_FONT = (px: number) => `800 ${Math.round(px)}px TxInter, "Inter", system-ui, -apple-system, sans-serif`;
const CORAL = '#d6334f';

function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
function mixWhite(hex: string, k: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) * (1 - k) + 255 * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/** Quebra o texto em linhas que cabem em `maxW` (respeita as mudanÃ§as de linha; no mÃ¡ximo 8 linhas). */
export function wrapText(g: Pick<Ctx, 'measureText'>, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? `${line} ${word}` : word;
      if (g.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out.slice(0, 8);
}

interface TextLayout { lines: string[]; widths: number[]; fs: number; lh: number; pad: number; bw: number; bh: number }
function layoutText(g: Ctx, o: TextOverlay, W: number): TextLayout {
  g.font = fontCss(o.font, o.size);
  const fs = o.size * fontById(o.font).k;
  const lines = wrapText(g, o.text || ' ', W * 0.84);
  const widths = lines.map((l) => g.measureText(l).width);
  const lh = fs * 1.22;
  const pad = o.bg === 'nenhum' ? fs * 0.12 : fs * 0.38;
  const bw = Math.max(fs * 1.2, ...widths) + pad * 2;
  const bh = lines.length * lh + pad * (o.bg === 'nenhum' ? 0.5 : 0.9);
  return { lines, widths, fs, lh, pad, bw, bh };
}

/** O tamanho de uma camada antes da escala dela (px do quadro). */
export function overlaySize(g: Ctx, o: Overlay, env: OverlayEnv): { w: number; h: number } {
  if (o.kind === 'text') { const L = layoutText(g, o, env.W); return { w: L.bw, h: L.bh }; }
  return stickerLayout(g, o, env).size;
}

function drawText(g: Ctx, o: TextOverlay, f: AnimFrame, t: number, S: number, W: number) {
  const L = layoutText(g, o, W);
  const total = L.lines.reduce((n, l) => n + l.length, 0);
  let left = visibleChars(total, f.chars);
  const perChar = f.wave > 0;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.lineJoin = 'round';
  const top = -L.bh / 2 + (o.bg === 'nenhum' ? L.pad * 0.25 : L.pad * 0.45);
  const fill = o.bg === 'cheio' ? contrastOn(o.color) : o.color;
  let caret: { x: number; y: number } | null = null;
  L.lines.forEach((line, i) => {
    const w = L.widths[i];
    const x0 = o.align === 'left' ? -L.bw / 2 + L.pad : o.align === 'right' ? L.bw / 2 - L.pad - w : -w / 2;
    const y = top + L.lh * (i + 0.5);
    const before = left;
    const shown = line.slice(0, Math.max(0, left));
    left -= line.length;
    if (f.chars < 1 && caret === null && before <= line.length) caret = { x: x0 + (shown ? g.measureText(shown).width + L.fs * 0.04 : 0), y };
    if (o.bg !== 'nenhum' && shown) {
      const sw = shown === line ? w : g.measureText(shown).width;
      g.save();
      g.shadowColor = 'transparent';
      g.fillStyle = o.bg === 'cheio' ? o.color : 'rgba(8,8,12,0.55)';
      roundRect(g, x0 - L.pad * 0.7, y - L.lh / 2 - L.fs * 0.02, sw + L.pad * 1.4, L.lh + L.fs * 0.04, L.fs * 0.3);
      g.fill();
      g.restore();
    }
    if (!shown) return;
    const paint = (fn: (txt: string, x: number, yy: number) => void) => {
      if (!perChar) { fn(shown, x0, y); return; }
      let x = x0;
      for (let k = 0; k < shown.length; k++) {
        const ch = shown[k];
        fn(ch, x, y + waveOffset(k + i * 7, t, f.wave, L.fs));
        x += g.measureText(ch).width;
      }
    };
    if (o.neon) {
      g.save();
      // Néon: um halo largo, outro perto, o tubo (contorno fino) e o miolo quase branco.
      g.fillStyle = o.color;
      g.shadowColor = o.color;
      g.shadowBlur = L.fs * 1.6 * S;
      paint((s, x, yy) => g.fillText(s, x, yy));
      g.shadowBlur = L.fs * 0.7 * S;
      paint((s, x, yy) => g.fillText(s, x, yy));
      g.lineWidth = L.fs * 0.06;
      g.strokeStyle = o.color;
      g.shadowBlur = L.fs * 0.25 * S;
      paint((s, x, yy) => g.strokeText(s, x, yy));
      g.shadowBlur = L.fs * 0.1 * S;
      g.fillStyle = mixWhite(o.color, 0.78);
      paint((s, x, yy) => g.fillText(s, x, yy));
      g.restore();
    } else {
      if (o.outline) {
        g.save();
        g.lineWidth = L.fs * 0.16;
        g.strokeStyle = contrastOn(o.color);
        if (o.shadow) { g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = L.fs * 0.2 * S; g.shadowOffsetY = L.fs * 0.05 * S; }
        paint((s, x, yy) => g.strokeText(s, x, yy));
        g.restore();
      }
      g.save();
      if (o.shadow && !o.outline && o.bg !== 'cheio') { g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = L.fs * 0.22 * S; g.shadowOffsetY = L.fs * 0.05 * S; }
      g.fillStyle = fill;
      paint((s, x, yy) => g.fillText(s, x, yy));
      g.restore();
    }
    if (f.glow > 0.01) {
      g.save();
      g.globalAlpha *= f.glow;
      g.shadowColor = '#fff';
      g.shadowBlur = L.fs * 1.4 * S * f.glow;
      g.fillStyle = mixWhite(o.color, 0.85);
      paint((s, x, yy) => g.fillText(s, x, yy));
      g.restore();
    }
  });
  const c = caret as { x: number; y: number } | null;
  if (c && f.chars < 1 && Math.floor(t * 3) % 2 === 0) {
    g.fillStyle = o.bg === 'cheio' ? fill : o.color;
    g.fillRect(c.x, c.y - L.fs * 0.42, L.fs * 0.07, L.fs * 0.84);
  }
}

interface StickerLayout { size: { w: number; h: number }; draw: (g: Ctx, S: number, t: number) => void }
function pill(g: Ctx, o: StickerOverlay, w: number, h: number, S: number) {
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.35)';
  g.shadowBlur = 24 * S;
  g.shadowOffsetY = 8 * S;
  if (o.variant === 'coral') {
    const grad = g.createLinearGradient(-w / 2, 0, w / 2, 0);
    grad.addColorStop(0, CORAL);
    grad.addColorStop(1, '#ff8a5c');
    g.fillStyle = grad;
  } else g.fillStyle = o.variant === 'escuro' ? 'rgba(12,12,18,0.78)' : '#ffffff';
  roundRect(g, -w / 2, -h / 2, w, h, Math.min(h / 2, 44));
  g.fill();
  g.restore();
  if (o.variant === 'escuro') {
    g.save();
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.lineWidth = 3;
    roundRect(g, -w / 2, -h / 2, w, h, Math.min(h / 2, 44));
    g.stroke();
    g.restore();
  }
}
const ink = (o: StickerOverlay) => (o.variant === 'branco' ? CORAL : '#ffffff');
const inkSoft = (o: StickerOverlay) => (o.variant === 'branco' ? '#18181b' : '#ffffff');
function pinPath(g: Ctx, x: number, y: number, s: number) {
  // Um alfinete de mapa (gota com um buraco), com a ponta em baixo.
  g.beginPath();
  g.moveTo(x, y + s * 0.62);
  g.bezierCurveTo(x - s * 0.1, y + s * 0.42, x - s * 0.42, y + s * 0.18, x - s * 0.42, y - s * 0.12);
  g.arc(x, y - s * 0.12, s * 0.42, Math.PI, 0);
  g.bezierCurveTo(x + s * 0.42, y + s * 0.18, x + s * 0.1, y + s * 0.42, x, y + s * 0.62);
  g.closePath();
  g.moveTo(x + s * 0.16, y - s * 0.12);
  g.arc(x, y - s * 0.12, s * 0.16, 0, Math.PI * 2, true);
}

function stickerLayout(g: Ctx, o: StickerOverlay, env: OverlayEnv): StickerLayout {
  const s = o.sticker;
  switch (s.type) {
    case 'emoji': {
      const fs = 230;
      g.font = `${fs}px ${EMOJI_FONT}`;
      const w = Math.max(fs, g.measureText(s.emoji).width);
      return { size: { w, h: fs * 1.12 }, draw: (c) => { c.font = `${fs}px ${EMOJI_FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s.emoji, 0, fs * 0.04); } };
    }
    case 'txill':
    case 'gif': {
      const im = env.image(o);
      const w = s.type === 'gif' ? 440 : 400;
      const ratio = im && im.w > 0 ? im.h / im.w : s.type === 'gif' && s.w > 0 ? s.h / s.w : 1;
      const h = w * ratio;
      return { size: { w, h }, draw: (c) => { if (im) c.drawImage(im.img, -w / 2, -h / 2, w, h); } };
    }
    case 'mention': {
      const fs = 60;
      const label = `@${s.username}`;
      g.font = LABEL_FONT(fs);
      const tw = g.measureText(label).width;
      const w = tw + fs * 1.1, h = fs * 1.75;
      return {
        size: { w, h },
        draw: (c, S) => { pill(c, o, w, h, S); c.font = LABEL_FONT(fs); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = ink(o); c.fillText(label, 0, fs * 0.04); },
      };
    }
    case 'location': {
      const fs = 54;
      const label = s.name.toUpperCase();
      g.font = LABEL_FONT(fs);
      const tw = g.measureText(label).width;
      const icon = fs * 1.05;
      const w = tw + icon + fs * 1.3, h = fs * 1.8;
      return {
        size: { w, h },
        draw: (c, S) => {
          pill(c, o, w, h, S);
          const x0 = -w / 2 + fs * 0.6;
          c.fillStyle = ink(o);
          pinPath(c, x0 + icon * 0.45, -fs * 0.04, icon * 0.9);
          c.fill('evenodd');
          c.font = LABEL_FONT(fs);
          c.textAlign = 'left';
          c.textBaseline = 'middle';
          c.fillStyle = inkSoft(o) === '#18181b' ? CORAL : '#fff';
          c.fillText(label, x0 + icon + fs * 0.2, fs * 0.05);
        },
      };
    }
    case 'time': {
      const lines = timeLabel(s.format, s.at);
      const big = s.format !== 'data';
      const f1 = big ? `800 120px TxOrbitron, ${EMOJI_FONT}` : LABEL_FONT(64);
      g.font = f1;
      const w1 = g.measureText(lines[0]).width;
      g.font = LABEL_FONT(46);
      const w2 = lines[1] ? g.measureText(lines[1]).width : 0;
      const w = Math.max(w1, w2) + 90;
      const h = big ? (lines[1] ? 250 : 180) : 120;
      return {
        size: { w, h },
        draw: (c, S) => {
          pill(c, o, w, h, S);
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillStyle = ink(o);
          c.font = f1;
          c.fillText(lines[0], 0, lines[1] ? -38 : 4);
          if (lines[1]) { c.font = LABEL_FONT(46); c.fillStyle = inkSoft(o); c.fillText(lines[1], 0, 72); }
        },
      };
    }
  }
}

/** Desenha as camadas visÃ­veis em `t` (pela ordem: a Ãºltima fica por cima) e devolve onde ficou cada uma. */
export function drawOverlays(g: Ctx, overlays: readonly Overlay[], t: number, env: OverlayEnv): OverlayBox[] {
  const boxes: OverlayBox[] = [];
  for (const o of overlays) {
    const f = animState(o, t);
    if (!f.visible) continue;
    const S = Math.max(0.05, o.scale * f.scale);
    let size: { w: number; h: number };
    g.save();
    g.globalAlpha = f.alpha;
    g.translate(o.x * env.W + f.dx, o.y * env.H + f.dy);
    g.rotate(((o.rot + f.rot) * Math.PI) / 180);
    g.scale(S, S);
    if (o.kind === 'text') {
      size = overlaySize(g, o, env);
      drawText(g, o, f, t, S, env.W);
    } else {
      const L = stickerLayout(g, o, env);
      size = L.size;
      L.draw(g, S, t);
    }
    g.restore();
    boxes.push({ id: o.id, cx: o.x * env.W, cy: o.y * env.H, w: size.w * o.scale, h: size.h * o.scale, rot: o.rot });
  }
  return boxes;
}

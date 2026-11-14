import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { textFontOf } from '@txillapp/shared';
import { fontById } from '../compose/effects';
import { ensureStudioFonts } from '../compose/studio-canvas';
import { layoutTextLayer, type TextLayerInput } from './text-layer';

/**
 * Os textos dos mimos gravados na cópia: desenhados no canvas do Node (Skia) com as fontes do estúdio (assets/fonts/estudio,
 * as mesmas do site e da app) e metidos no SVG da assinatura como imagem. O SVG (librsvg) não conhece estas fontes: a
 * letra sai certa só porque quem a desenha é o canvas.
 */
export function fontString(font: string, px: number): string {
  const f = fontById(textFontOf(font));
  // Depois da fonte do estúdio, a dos emojis (registada também como «system-ui» em ensureStudioFonts).
  return `${f.style === 'italic' ? 'italic ' : ''}${f.weight} ${px.toFixed(2)}px ${f.family}, system-ui, sans-serif`;
}

/** Uma régua para a fonte: a largura de uma linha a `px` de letra. */
export function measurer(g: Pick<SKRSContext2D, 'font' | 'measureText'>, font: string) {
  return (line: string, px: number) => {
    g.font = fontString(font, px);
    return g.measureText(line).width;
  };
}

let ruler: SKRSContext2D | null = null;
function rulerCtx(): SKRSContext2D {
  ensureStudioFonts();
  return (ruler ??= createCanvas(4, 4).getContext('2d'));
}

const MAX_SIDE = 8192;

/** Um texto como fragmento SVG à escala de uma imagem W×H (a imagem PNG do texto, rodada à volta do centro). */
export function textLayerSvg(W: number, H: number, t: TextLayerInput & { font: string }): string {
  const L = layoutTextLayer(t, W, H, measurer(rulerCtx(), t.font));
  // Margem para a sombra não ficar cortada.
  const m = Math.ceil(L.fontPx * 0.3);
  const fw = L.w + m * 2, fh = L.h + m * 2;
  // Numa foto enorme, o texto desenha-se mais pequeno e o SVG estica-o (o canvas tem um limite de tamanho).
  const q = Math.min(1, MAX_SIDE / Math.max(fw, fh));
  const cw = Math.ceil(fw * q), ch = Math.ceil(fh * q);
  if (cw < 2 || ch < 2) return '';
  const c = createCanvas(cw, ch);
  const g = c.getContext('2d');
  g.scale(q, q);
  g.translate(m, m);
  if (L.box) {
    g.fillStyle = L.box;
    g.beginPath();
    g.roundRect(0, 0, L.w, L.h, L.radius);
    g.fill();
  }
  g.font = fontString(t.font, L.fontPx);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = L.fill;
  if (L.shadow) {
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = L.fontPx * 0.22;
    g.shadowOffsetY = L.fontPx * 0.05;
  }
  for (const line of L.lines) if (line.text) g.fillText(line.text, line.x, line.y);
  const png = c.toBuffer('image/png').toString('base64');
  const x = L.cx - L.w / 2 - m, y = L.cy - L.h / 2 - m;
  return `<g transform="rotate(${L.rot.toFixed(2)} ${L.cx.toFixed(2)} ${L.cy.toFixed(2)})"><image x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cw / q).toFixed(2)}" height="${(ch / q).toFixed(2)}" preserveAspectRatio="none" href="data:image/png;base64,${png}"/></g>`;
}

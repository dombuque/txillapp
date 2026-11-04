/**
 * A imagem de um Zás "como está desenhado": a foto dentro da moldura (squircle, com cantos transparentes) e a legenda a correr pela curva.
 * Usa as mesmas contas do desenho no ecrã, por isso o resultado guardado é igual ao que se vê.
 */
const N = 3.4; // expoente do squircle (igual ao SQUIRCLE do ecrã)

const super2 = (c: number) => Math.sign(c) * Math.abs(c) ** (2 / N);

/** Pontos do troço da curva onde corre a legenda (em pixéis da imagem). */
function arcPoints(w: number, h: number, arc: 'top' | 'bottom') {
  const inset = Math.min(w, h) * 0.1;
  const a = arc === 'top' ? Math.PI + 0.22 : Math.PI - 0.5;
  const b = arc === 'top' ? 2 * Math.PI - 0.3 : 0.45;
  const steps = 160;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = a + ((b - a) * i) / steps;
    pts.push({ x: w / 2 + (w / 2 - inset) * super2(Math.cos(t)), y: h / 2 + (h / 2 - inset) * super2(Math.sin(t)) });
  }
  return pts;
}

function drawCaption(g: CanvasRenderingContext2D, text: string, w: number, h: number, arc: 'top' | 'bottom') {
  const label = text.toUpperCase();
  if (!label) return;
  const pts = arcPoints(w, h, arc);
  // Comprimento acumulado da curva.
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const len = cum[cum.length - 1];
  const fs = Math.max(8 * (w / 300), Math.min(Math.min(w, h) * 0.052, (len - 14 * (w / 300)) / (label.length * 0.8)));
  g.font = `700 ${fs}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  const spacing = fs * 0.16;
  let at = 0;
  for (const ch of label) {
    const cw = g.measureText(ch).width;
    const mid = at + cw / 2;
    if (mid > len) break;
    // Ponto e direção da curva no meio do caractere.
    let k = 1;
    while (k < cum.length - 1 && cum[k] < mid) k++;
    const p0 = pts[k - 1];
    const p1 = pts[k];
    const f = (mid - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
    const x = p0.x + (p1.x - p0.x) * f;
    const y = p0.y + (p1.y - p0.y) * f;
    const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.lineWidth = 2.4 * (w / 300);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.strokeText(ch, -cw / 2, 0);
    g.fillStyle = '#fff';
    g.fillText(ch, -cw / 2, 0);
    g.restore();
    at += cw + spacing;
  }
}

/** PNG da foto dentro da moldura, com a legenda (se existir). `arc` deve ser 'top' (onde se escreve). */
export async function renderZasImage(url: string, caption: string, width = 1080): Promise<Blob> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const height = Math.round((width * 4) / 3);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d')!;
  // Moldura: o contorno do squircle recorta a imagem (fora dele fica transparente).
  g.beginPath();
  const steps = 180;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const x = width / 2 + (width / 2) * super2(Math.cos(t));
    const y = height / 2 + (height / 2) * super2(Math.sin(t));
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.clip();
  // A foto preenche (como object-cover).
  const k = Math.max(width / bmp.width, height / bmp.height);
  const dw = bmp.width * k;
  const dh = bmp.height * k;
  g.drawImage(bmp, (width - dw) / 2, (height - dh) / 2, dw, dh);
  if (caption) drawCaption(g, caption, width, height, 'top');
  bmp.close?.();
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Não consegui criar a imagem'))), 'image/png'));
}

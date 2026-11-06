import { Platform, Share } from 'react-native';
import { arcPoints, sup } from './squircle';

/**
 * A imagem de um Zás "como está desenhado" (só na web): a foto dentro da moldura (squircle, cantos transparentes) e a legenda a correr pela curva.
 * Usa as mesmas contas do desenho no ecrã, por isso o resultado guardado é igual ao que se vê.
 */
function drawCaption(g: CanvasRenderingContext2D, text: string, w: number, h: number) {
  const label = text.toUpperCase();
  if (!label) return;
  const pts = arcPoints(w, h, 'top', 160);
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
    let k = 1;
    while (k < cum.length - 1 && cum[k] < mid) k++;
    const p0 = pts[k - 1];
    const p1 = pts[k];
    const f = (mid - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
    g.save();
    g.translate(p0.x + (p1.x - p0.x) * f, p0.y + (p1.y - p0.y) * f);
    g.rotate(Math.atan2(p1.y - p0.y, p1.x - p0.x));
    g.lineWidth = 2.4 * (w / 300);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.strokeText(ch, -cw / 2, 0);
    g.fillStyle = '#fff';
    g.fillText(ch, -cw / 2, 0);
    g.restore();
    at += cw + spacing;
  }
}

/** PNG da foto dentro da moldura, com a legenda (se existir). */
export async function renderZasImage(url: string, caption: string, width = 1080): Promise<Blob> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const height = Math.round((width * 4) / 3);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d')!;
  g.beginPath();
  const steps = 180;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const x = width / 2 + (width / 2) * sup(Math.cos(t));
    const y = height / 2 + (height / 2) * sup(Math.sin(t));
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.clip();
  const k = Math.max(width / bmp.width, height / bmp.height);
  const dw = bmp.width * k;
  const dh = bmp.height * k;
  g.drawImage(bmp, (width - dw) / 2, (height - dh) / 2, dw, dh);
  if (caption) drawCaption(g, caption, width, height);
  bmp.close?.();
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Não consegui criar a imagem'))), 'image/png'));
}

/** Descarrega um ficheiro (sem folha de partilha). */
function downloadFile(f: File) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(f);
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}

type Z = { id: string; url: string; caption?: string };
const photoOf = async (it: Z) => new File([await renderZasImage(it.url, it.caption ?? '')], `zas-${it.id.slice(0, 8)}.png`, { type: 'image/png' });

/**
 * Guardar o Zás como está desenhado. 'gallery': no telemóvel abre a folha do sistema («Guardar imagem»); 'file': descarrega o PNG.
 * No nativo abre a folha de partilha do sistema com a foto.
 */
export async function saveZas(it: Z, mode: 'gallery' | 'file' = 'gallery') {
  if (Platform.OS !== 'web') return void (await Share.share({ url: it.url, message: it.caption || undefined }).catch(() => undefined));
  try {
    const f = await photoOf(it);
    if (mode === 'gallery' && navigator.canShare?.({ files: [f] })) return void (await navigator.share({ files: [f] }));
    downloadFile(f);
  } catch (e) {
    if ((e as Error).name !== 'AbortError') window.open(it.url, '_blank');
  }
}

/** Partilhar a foto (Web Share API; sem ela copia a legenda). */
export async function shareZas(it: Z) {
  if (Platform.OS !== 'web') return void (await Share.share({ url: it.url, message: it.caption || undefined }).catch(() => undefined));
  try {
    const f = await photoOf(it);
    if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], text: it.caption || undefined });
    else await navigator.clipboard?.writeText(it.caption || '');
  } catch {
    /* cancelado: nada a fazer */
  }
}

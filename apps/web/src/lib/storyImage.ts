/**
 * Imagem de story para partilhar fora do Txillapp (por exemplo, no status do WhatsApp): a publicação num cartão arredondado
 * sobre um fundo desfocado da própria foto, com quem publicou em cima e, em baixo, o botão "Ver no Txillapp" com o link curto.
 * O WhatsApp não tem autocolante de link como o Instagram, por isso o link vai desenhado dentro da imagem.
 */
const W = 1080;
const H = 1920;

const loadBitmap = async (blob: Blob) => createImageBitmap(blob);

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Desenha `img` a cobrir o retângulo (como object-fit: cover). */
function cover(ctx: CanvasRenderingContext2D, img: ImageBitmap, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

export async function composeStoryImage(photo: Blob, o: { displayName: string; username: string; link: string; avatar?: Blob | null }): Promise<File> {
  const img = await loadBitmap(photo);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Fundo: a mesma foto, muito pequena e esticada (fica desfocada, sem precisar de filtros), com um véu escuro.
  const small = document.createElement('canvas');
  small.width = 24;
  small.height = 42;
  cover(small.getContext('2d')!, img, 0, 0, 24, 42);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, W, H);
  const veil = ctx.createLinearGradient(0, 0, 0, H);
  veil.addColorStop(0, 'rgba(20,20,30,0.55)');
  veil.addColorStop(1, 'rgba(20,20,30,0.75)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, W, H);

  // Quem publicou, em cima.
  const topY = 170;
  let nameX = 90;
  if (o.avatar) {
    const av = await loadBitmap(o.avatar).catch(() => null);
    if (av) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(130, topY, 44, 0, Math.PI * 2);
      ctx.clip();
      cover(ctx, av, 86, topY - 44, 88, 88);
      ctx.restore();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.arc(130, topY, 44, 0, Math.PI * 2);
      ctx.stroke();
      nameX = 200;
    }
  }
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.font = '700 44px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(o.displayName.slice(0, 26), nameX, topY - 14);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '500 34px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(`@${o.username}`, nameX, topY + 30);

  // O cartão com a publicação, ao centro.
  const boxW = 900;
  const maxH = 1120;
  const scale = Math.min(boxW / img.width, maxH / img.height);
  const cw = Math.round(img.width * scale);
  const ch = Math.round(img.height * scale);
  const cx = Math.round((W - cw) / 2);
  const cy = Math.round(330 + (maxH - ch) / 2);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 20;
  ctx.fillStyle = '#fff';
  roundRect(ctx, cx, cy, cw, ch, 44);
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, cx, cy, cw, ch, 44);
  ctx.clip();
  ctx.drawImage(img, cx, cy, cw, ch);
  ctx.restore();

  // O "botão" com o link, em baixo.
  const pillW = 760;
  const pillH = 150;
  const px = (W - pillW) / 2;
  const py = 1560;
  ctx.fillStyle = '#d6334f';
  roundRect(ctx, px, py, pillW, pillH, 75);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = '800 46px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText('Ver no Txillapp', W / 2, py + 52);
  ctx.font = '500 34px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(o.link.replace(/^https?:\/\//, ''), W / 2, py + 105);

  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('canvas'))), 'image/jpeg', 0.92));
  return new File([blob], 'txillapp-story.jpg', { type: 'image/jpeg' });
}

import type { Post } from './api';

/**
 * O cartão de um presente como imagem de story (9:16): o mesmo bilhete a degradê do post, com as duas fotos cruzadas,
 * "X presenteou Y", o valor em Txills e a mensagem num balão.
 */
function loadAvatar(username: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = `/api/v1/avatars/${encodeURIComponent(username)}`;
  });
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…');
  }
  return lines;
}

export async function renderGiftCard(post: Post): Promise<Blob> {
  const g0 = post.gift!;
  const W = 1080;
  const H = 1920;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#d6334f');
  bg.addColorStop(0.55, '#e8475f');
  bg.addColorStop(1, '#ff8a5b');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.10)';
  for (const [x, y, r] of [[120, 260, 220], [980, 1500, 300], [880, 330, 40], [200, 1250, 28], [540, 1780, 90]] as const) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  // As duas fotos, cruzadas, e o símbolo do presente por baixo.
  const [sender, recipient] = await Promise.all([loadAvatar(post.author.username), loadAvatar(g0.recipient.username)]);
  const circle = (img: HTMLImageElement | null, name: string, cx: number, cy: number, r: number) => {
    g.save();
    g.beginPath();
    g.arc(cx, cy, r + 14, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.fill();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.clip();
    if (img) {
      const k = Math.max((r * 2) / img.width, (r * 2) / img.height);
      g.drawImage(img, cx - (img.width * k) / 2, cy - (img.height * k) / 2, img.width * k, img.height * k);
    } else {
      g.fillStyle = '#f4b4be';
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
      g.fillStyle = '#d6334f';
      g.font = `800 ${r}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText((name.trim()[0] ?? '?').toUpperCase(), cx, cy + r * 0.05);
    }
    g.restore();
  };
  const cy = 560;
  circle(recipient, g0.recipient.displayName, W / 2 + 130, cy, 150);
  circle(sender, post.author.displayName, W / 2 - 130, cy, 150);
  // Símbolo do presente.
  const gx = W / 2;
  const gy = cy + 190;
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(gx, gy, 70, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#d6334f';
  g.lineWidth = 9;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeRect(gx - 30, gy - 8, 60, 42);
  g.strokeRect(gx - 36, gy - 26, 72, 20);
  g.beginPath();
  g.moveTo(gx, gy - 26);
  g.lineTo(gx, gy + 34);
  g.stroke();

  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff';
  g.font = `600 56px ${FONT}`;
  const who = wrap(g, `${post.author.displayName} presenteou ${g0.recipient.displayName}`, W - 200, 3);
  who.forEach((l, i) => g.fillText(l, W / 2, 900 + i * 70));
  const ay = 900 + who.length * 70 + 220;
  g.font = `900 260px ${FONT}`;
  g.fillText(g0.amount.toLocaleString('pt-PT'), W / 2, ay);
  g.font = `800 52px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.88)';
  (g as unknown as { letterSpacing: string }).letterSpacing = '14px';
  g.fillText('TXILLS', W / 2, ay + 90);
  (g as unknown as { letterSpacing: string }).letterSpacing = '0px';

  if (post.body) {
    g.font = `500 54px ${FONT}`;
    const lines = wrap(g, post.body, W - 360, 4);
    const bh = lines.length * 70 + 70;
    const by = ay + 170;
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.roundRect(120, by, W - 240, bh, 56);
    g.fill();
    g.fillStyle = '#fff';
    lines.forEach((l, i) => g.fillText(l, W / 2, by + 85 + i * 70));
  }

  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.font = `900 70px ${FONT}`;
  g.fillText('txillapp', W / 2, H - 110);
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Não consegui criar o cartão'))), 'image/png'));
}

import { createCanvas, Path2D, type SKRSContext2D } from '@napi-rs/canvas';
import sharp from 'sharp';
import { baseFont } from '../instants/zas-card';
import { SEAL_CHECK, SEAL_CORAL, SEAL_BLUE, SEAL_PATH, sealPaint, signatureSvg, type SealTier } from '../media/signature';

/**
 * O cartão do «Resumo da semana» do Mixar (0172), para partilhar no Zás ou nos mimos: um quadro 9:16 escuro com as cores do
 * Mixar (o vinho do Mixa Challenge e a luz coral), «Resumo da semana» e as datas, os dois círculos com as iniciais, «Dom +
 * Ana» (com o selo de quem é verificado), a série, os acertos no desafio, os vídeos vistos e os temas da semana; em baixo, a
 * assinatura do Txillapp (logótipo, @ e selo de quem partilha). Os temas que chegam aqui já vêm sem os privados dos dois.
 * O vídeo mais reagido não entra na imagem: é de outra pessoa e pode ser de uma conta privada.
 */
export const WEEK_OUT = { W: 1080, H: 1920 } as const;

export interface WeekCardInput {
  /** «10 a 16 nov». */
  label: string;
  me: { name: string; seal: SealTier | null };
  them: { name: string; seal: SealTier | null };
  username: string;
  mySeal: SealTier | null;
  streak: number;
  challenge: { matches: number; played: number };
  videos: number;
  topics: string[];
}

/** Os textos de cada número (também para os testes). */
export function weekStatLines(o: Pick<WeekCardInput, 'streak' | 'challenge' | 'videos'>): { value: string; label: string }[] {
  return [
    { value: String(o.streak), label: o.streak === 1 ? 'dia de série' : 'dias de série' },
    o.challenge.played > 0
      ? { value: `${o.challenge.matches} de ${o.challenge.played}`, label: 'acertos no Mixa Challenge' }
      : { value: '0', label: 'desafios jogados' },
    { value: String(o.videos), label: o.videos === 1 ? 'vídeo visto esta semana' : 'vídeos vistos esta semana' },
  ];
}

const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

function roundRect(g: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** O selo (a roseta e o visto), com `size` px, com o canto de cima à esquerda em (x, y). */
function drawSeal(g: SKRSContext2D, tier: SealTier, x: number, y: number, size: number) {
  const k = size / 24;
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  if (sealPaint(tier) === 'blue') g.fillStyle = SEAL_BLUE;
  else {
    const gr = g.createLinearGradient(0, 0, 24, 24);
    gr.addColorStop(0, SEAL_CORAL[0]);
    gr.addColorStop(1, SEAL_CORAL[1]);
    g.fillStyle = gr;
  }
  g.fill(new Path2D(SEAL_PATH));
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke(new Path2D(SEAL_CHECK));
  g.restore();
}

/** O cartão desenhado, em JPEG 1080×1920. */
export async function renderWeekCard(o: WeekCardInput): Promise<Buffer> {
  const { W, H } = WEEK_OUT;
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const font = baseFont();

  // O fundo: o vinho do Mixa Challenge, com a luz coral em cima e laranja em baixo.
  const bg = g.createLinearGradient(0, 0, W * 0.6, H);
  bg.addColorStop(0, '#2a0b12');
  bg.addColorStop(0.5, '#4a1020');
  bg.addColorStop(1, '#120608');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, 0, 0, W / 2, 0, W);
  glow.addColorStop(0, 'rgba(214,51,79,0.45)');
  glow.addColorStop(1, 'rgba(214,51,79,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  const low = g.createRadialGradient(W / 2, H, 0, W / 2, H, W * 0.9);
  low.addColorStop(0, 'rgba(255,154,91,0.28)');
  low.addColorStop(1, 'rgba(255,154,91,0)');
  g.fillStyle = low;
  g.fillRect(0, 0, W, H);

  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffb4a2';
  g.font = `bold 40px ${font}`;
  g.fillText('M I X A R', W / 2, 170);
  g.fillStyle = '#ffffff';
  g.font = `bold 88px ${font}`;
  g.fillText('Resumo da semana', W / 2, 290, W - 96);
  g.fillStyle = '#ffb4a2';
  g.font = `bold 46px ${font}`;
  g.fillText(o.label, W / 2, 368);

  // Os dois círculos com as iniciais (eu atrás, o outro à frente), com o aro escuro a separá-los.
  const R = 92, cy = 560, gap = 62;
  const circle = (cx: number, name: string, colors: [string, string]) => {
    g.beginPath();
    g.arc(cx, cy, R + 8, 0, Math.PI * 2);
    g.fillStyle = '#2a0b12';
    g.fill();
    const gr = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    gr.addColorStop(0, colors[0]);
    gr.addColorStop(1, colors[1]);
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fillStyle = gr;
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = `bold 84px ${font}`;
    g.textBaseline = 'middle';
    g.fillText(initial(name), cx, cy + 4);
    g.textBaseline = 'alphabetic';
  };
  circle(W / 2 - gap, o.me.name, ['#d6334f', '#ff9a5b']);
  circle(W / 2 + gap, o.them.name, ['#ff9a5b', '#d6334f']);

  // «Dom + Ana», com o selo a seguir a cada nome verificado (o tamanho baixa se não couber).
  let size = 76;
  const seal = (s: SealTier | null) => (s ? size * 1.05 + size * 0.15 : 0);
  const widthOf = () => {
    g.font = `bold ${size}px ${font}`;
    return g.measureText(o.me.name).width + seal(o.me.seal) + g.measureText(' + ').width + g.measureText(o.them.name).width + seal(o.them.seal);
  };
  while (size > 40 && widthOf() > W - 120) size -= 4;
  const total = widthOf();
  let x = (W - total) / 2;
  const nameY = 790;
  g.textAlign = 'left';
  g.fillStyle = '#ffffff';
  const part = (t: string, s: SealTier | null) => {
    g.fillText(t, x, nameY);
    x += g.measureText(t).width;
    if (s) {
      const sz = size * 1.05;
      drawSeal(g, s, x + size * 0.15, nameY - size * 0.36 - sz / 2, sz);
      x += seal(s);
    }
  };
  part(o.me.name, o.me.seal);
  g.fillStyle = '#ffb4a2';
  part(' + ', null);
  g.fillStyle = '#ffffff';
  part(o.them.name, o.them.seal);

  // Os números: dois cartões lado a lado e um largo por baixo.
  const stats = weekStatLines(o);
  const side = 72, cg = 28, top = 880, ch = 250;
  const half = (W - side * 2 - cg) / 2;
  const boxes = [
    { x: side, y: top, w: half },
    { x: side + half + cg, y: top, w: half },
    { x: side, y: top + ch + cg, w: W - side * 2 },
  ];
  boxes.forEach((b, i) => {
    roundRect(g, b.x, b.y, b.w, ch, 44);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.stroke();
    g.textAlign = 'left';
    g.fillStyle = '#ffffff';
    let vs = 104;
    g.font = `bold ${vs}px ${font}`;
    while (vs > 56 && g.measureText(stats[i].value).width > b.w - 80) {
      vs -= 6;
      g.font = `bold ${vs}px ${font}`;
    }
    g.fillText(stats[i].value, b.x + 44, b.y + 132);
    g.fillStyle = 'rgba(255,255,255,0.78)';
    // A etiqueta encolhe até caber (sem a apertar: o maxWidth do canvas deformava as letras).
    let ls = 36;
    g.font = `bold ${ls}px ${font}`;
    while (ls > 24 && g.measureText(stats[i].label).width > b.w - 80) {
      ls -= 2;
      g.font = `bold ${ls}px ${font}`;
    }
    g.fillText(stats[i].label, b.x + 44, b.y + 196, b.w - 80);
  });

  // Os temas da semana, em chips (no máximo 5, em duas filas).
  const topics = o.topics.slice(0, 5);
  if (topics.length) {
    let ty = top + ch * 2 + cg + 110;
    g.textAlign = 'center';
    g.fillStyle = '#ffb4a2';
    g.font = `bold 36px ${font}`;
    g.fillText('OS VOSSOS TEMAS DA SEMANA', W / 2, ty);
    ty += 40;
    g.font = `bold 42px ${font}`;
    const pad = 34, chipH = 84, chipGap = 18;
    const rows: { t: string; w: number }[][] = [[]];
    let rowW = 0;
    for (const t of topics) {
      const w = Math.min(W - side * 2, g.measureText(t).width + pad * 2);
      if (rows[rows.length - 1].length && rowW + chipGap + w > W - side * 2) {
        if (rows.length === 2) break;
        rows.push([]);
        rowW = 0;
      }
      rowW += (rows[rows.length - 1].length ? chipGap : 0) + w;
      rows[rows.length - 1].push({ t, w });
    }
    for (const row of rows) {
      const rw = row.reduce((s, r) => s + r.w, 0) + chipGap * (row.length - 1);
      let cx = (W - rw) / 2;
      for (const r of row) {
        roundRect(g, cx, ty, r.w, chipH, chipH / 2);
        g.fillStyle = 'rgba(255,255,255,0.16)';
        g.fill();
        g.fillStyle = '#ffffff';
        g.textBaseline = 'middle';
        g.fillText(r.t, cx + r.w / 2, ty + chipH / 2 + 2, r.w - pad);
        g.textBaseline = 'alphabetic';
        cx += r.w + chipGap;
      }
      ty += chipH + chipGap;
    }
  }

  return sharp(c.toBuffer('image/png'))
    .composite([{ input: Buffer.from(signatureSvg(W, H, o.username, '', true, o.mySeal)), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

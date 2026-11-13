import sharp from 'sharp';
import type { SnapshotItem } from './geleira-post';

/**
 * O cartão do link de um post da geleira (og:image, 1200×630): o frigorífico aberto com as prateleiras, como o FridgeArt da
 * app, o nome de quem partilhou e os gostos em etiquetas. É público (os robôs das redes não têm idade): nunca leva bebidas
 * alcoólicas. As letras são a DejaVu Sans, que vem na imagem do servidor (Dockerfile).
 */

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
/** As cores dos produtos na prateleira e das etiquetas (as mesmas da app: TasteBubble/FridgeArt). */
const DOTS = ['#fb7185', '#fbbf24', '#34d399', '#60a5fa', '#c084fc', '#fb923c', '#f472b6', '#2dd4bf'];
const PILLS = [
  { bg: '#fff1f2', fg: '#be123c' }, { bg: '#fffbeb', fg: '#b45309' }, { bg: '#ecfdf5', fg: '#047857' }, { bg: '#f5f3ff', fg: '#6d28d9' },
  { bg: '#f0f9ff', fg: '#0369a1' }, { bg: '#fdf4ff', fg: '#a21caf' }, { bg: '#fff7ed', fg: '#c2410c' }, { bg: '#f0fdfa', fg: '#0f766e' },
];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const EDGE = ['#a9c9d9', '#8fd0ee', '#6fc4ea', '#f08aa0', '#e8a317'];

/** Largura aproximada de um texto em DejaVu Sans Bold (px). */
const textW = (s: string, size: number) => [...s].length * size * 0.62;
const clip = (s: string, max: number) => ([...s].length > max ? `${[...s].slice(0, max - 1).join('')}…` : s);

export function geleiraCardSvg(o: { name: string; total: number; level: number; items: Pick<SnapshotItem, 'name' | 'slug'>[]; closed?: boolean }): string {
  const edge = EDGE[Math.max(0, Math.min(4, o.level))];
  // O frigorífico (viewBox da app 100×130, aqui ×3,9 à esquerda).
  const dots = o.items.slice(0, 9).map((it, i) => {
    const shelf = [34, 58, 82][Math.floor(i / 3)];
    return `<circle cx="${28 + (i % 3) * 18}" cy="${shelf - 6}" r="6.5" fill="${DOTS[hash(it.slug) % DOTS.length]}" stroke="#fff" stroke-width="1.5"/>`;
  }).join('');
  const fridge =
    `<g transform="translate(120 70) scale(3.75)">` +
    `<ellipse cx="50" cy="124" rx="36" ry="4" fill="#0e7490" opacity="0.14"/>` +
    `<rect x="20" y="118" width="9" height="6" rx="2" fill="#7b9aab"/><rect x="71" y="118" width="9" height="6" rx="2" fill="#7b9aab"/>` +
    `<rect x="14" y="6" width="72" height="114" rx="11" fill="url(#body)" stroke="${edge}" stroke-width="3"/>` +
    `<rect x="20" y="12" width="60" height="102" rx="7" fill="url(#inside)" stroke="${edge}" stroke-width="1.5"/>` +
    [38, 62, 86].map((y) => `<rect x="20" y="${y}" width="60" height="4.5" fill="#fff" stroke="#9fd6ee" stroke-width="1"/>`).join('') +
    dots +
    `<path d="M14 6 L-6 14 L-6 112 L14 120 Z" fill="#fff" stroke="${edge}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M-6 52 L14 54" stroke="${edge}" stroke-width="2.5"/>` +
    `<rect x="-2" y="26" width="3.5" height="16" rx="1.7" fill="#9ab8c8"/><rect x="-2" y="64" width="3.5" height="22" rx="1.7" fill="#9ab8c8"/>` +
    `<circle cx="50" cy="19" r="3" fill="#fde68a"/>` +
    `</g>`;

  // As etiquetas dos gostos, em filas de até 620 px.
  const left = 560;
  const maxW = 1200 - left - 60;
  let x = left;
  let y = 330;
  const pills: string[] = [];
  let shown = 0;
  for (const it of o.items) {
    const label = clip(it.name, 22);
    const w = Math.round(textW(label, 26) + 40);
    if (x + w > left + maxW) {
      x = left;
      y += 64;
    }
    if (y > 520) break;
    const p = PILLS[hash(it.slug) % PILLS.length];
    pills.push(`<rect x="${x}" y="${y}" width="${w}" height="50" rx="25" fill="${p.bg}"/><text x="${x + 20}" y="${y + 34}" font-size="26" font-weight="700" fill="${p.fg}">${xml(label)}</text>`);
    x += w + 12;
    shown += 1;
  }
  const more = o.total - shown;
  const title = clip(o.name, 22);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="DejaVu Sans, sans-serif">` +
    `<defs>` +
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0f9ff"/><stop offset="1" stop-color="#fff1f2"/></linearGradient>` +
    `<linearGradient id="body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e4f1f8"/></linearGradient>` +
    `<linearGradient id="inside" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf2"/><stop offset="1" stop-color="#e2f3fb"/></linearGradient>` +
    `</defs>` +
    `<rect width="1200" height="630" fill="url(#bg)"/>` +
    `<circle cx="1120" cy="70" r="140" fill="#fecdd3" opacity="0.35"/><circle cx="80" cy="600" r="120" fill="#bae6fd" opacity="0.35"/>` +
    fridge +
    `<text x="${left}" y="150" font-size="30" font-weight="700" fill="#0369a1" letter-spacing="3">A GELEIRA DE</text>` +
    `<text x="${left}" y="222" font-size="62" font-weight="800" fill="#18181b">${xml(title)}</text>` +
    `<text x="${left}" y="282" font-size="30" fill="#52525b">${o.closed ? 'Conta privada · entra para ver e brindar' : `${o.total} ${o.total === 1 ? 'gosto' : 'gostos'} · brinda no Txillapp`}</text>` +
    pills.join('') +
    (more > 0 ? `<text x="${left}" y="${Math.min(y + 100, 600)}" font-size="26" font-weight="700" fill="#71717a">e mais ${more}</text>` : '') +
    `<text x="1140" y="600" font-size="34" font-weight="800" fill="#d6334f" text-anchor="end">txillapp</text>` +
    `</svg>`
  );
}

export function geleiraCardPng(o: Parameters<typeof geleiraCardSvg>[0]): Promise<Buffer> {
  return sharp(Buffer.from(geleiraCardSvg(o))).png({ compressionLevel: 8 }).toBuffer();
}

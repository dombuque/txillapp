import sharp, { type OverlayOptions } from 'sharp';
import { LOGO_BOX, logoSvgPaths } from '../media/marca';
import { STICKER_ART } from '../stories/sticker-art';

/**
 * O cartão do convite feito no servidor, para a pré-visualização das ligações /c/CÓDIGO no WhatsApp (og:image, 1200×630).
 * O mesmo desenho do cartão que a app gera no aparelho (lib/inviteCard.ts), arrumado ao comprido. Só leva o que já é
 * público: o nome, a foto de perfil e os itens da geleira que a pessoa mostra a todos (nunca álcool: não se sabe a idade de quem vê).
 */
export const OG_W = 1200;
export const OG_H = 630;

/** As frases do cartão (as mesmas da app). */
export const PHRASES = ['Bora txilar no Txillapp, malta!', 'A tua malta já cá está', 'Traz a tua malta'] as const;
/** A personagem que acompanha cada frase (o Gelinho, a geleira, em três stickers). */
const CHAR_OF = ['vem-ca', 'malta-ja', 'bue-fixe'] as const;

/** Frase fixa por código (o mesmo convite dá sempre o mesmo cartão, para a cache do WhatsApp não baralhar). */
export function phraseIndexOf(code: string): number {
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % PHRASES.length;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cut = (t: string, n: number) => {
  const a = [...t.trim()];
  return a.length > n ? `${a.slice(0, n - 1).join('').trimEnd()}…` : a.join('');
};
const FONT = 'DejaVu Sans, Helvetica, Arial, sans-serif';

/**
 * O logótipo oficial (media/marca.ts, formas cheias: letras escuras, ponto do i a coral) numa pastilha branca, para se ler
 * bem em cima do degradê. A caixa x, y, largura é a do desenho; a pastilha fica à volta dela.
 */
const wordmark = (x: number, y: number, width: number) => {
  const s = width / LOGO_BOX.w;
  const h = LOGO_BOX.h * s;
  const px = 0.16 * h * 1.6;
  const py = 0.3 * h;
  const pill = `<rect x="${x - px}" y="${y - py}" width="${width + 2 * px}" height="${h + 2 * py}" rx="${(h + 2 * py) / 2}" fill="#ffffff"/>`;
  return `${pill}<g transform="translate(${x - LOGO_BOX.x * s} ${y - LOGO_BOX.y * s}) scale(${s})">${logoSvgPaths('#1f1b24', '#d6334f')}</g>`;
};

/** Um sticker da biblioteca (arte em SVG) dentro da caixa x,y,w (mantém a proporção), com uma inclinação. */
const sticker = (id: string, x: number, y: number, w: number, rot = 0) => {
  const art = STICKER_ART[id];
  if (!art) return '';
  const [vx, vy, vw, vh] = art.vb.split(/\s+/).map(Number);
  const s = w / (vw || 100);
  const h = (vh || 100) * s;
  return `<g transform="rotate(${rot} ${x + w / 2} ${y + h / 2}) translate(${x} ${y}) scale(${s}) translate(${-(vx || 0)} ${-(vy || 0)})">${art.body}</g>`;
};

export interface OgCardInput {
  code: string;
  displayName: string;
  /** Itens públicos da geleira (já sem álcool), no máximo 3 usados. */
  items: string[];
  reward: number;
  /** A foto de perfil em bytes (qualquer formato que o sharp leia), ou null para as iniciais. */
  avatar: Buffer | null;
}

/** As iniciais (até duas letras) para quem não tem foto. */
export const initialsOf = (name: string) =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]?.toUpperCase() ?? '').join('') || 'T';

/** O SVG do cartão (sem a foto: a foto entra por cima, já recortada em círculo). Exportado para os testes. */
export function ogCardSvg(p: Omit<OgCardInput, 'avatar'> & { hasAvatar: boolean }): string {
  const i = phraseIndexOf(p.code);
  const name = cut(p.displayName || 'Alguém', 20);
  const AV = { cx: 250, cy: 300, r: 160 };
  // Os itens da geleira em pastilhas (largura estimada pelo número de letras).
  let chipX = 480;
  const chips = p.items.slice(0, 3).map((raw) => {
    const t = cut(raw, 16);
    const w = Math.round([...t].length * 30 * 0.6 + 44);
    if (chipX + w > OG_W - 50) return '';
    const g = `<rect x="${chipX}" y="430" width="${w}" height="54" rx="27" fill="#ffffff" fill-opacity="0.22"/><text x="${chipX + w / 2}" y="466" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="700" fill="#ffffff">${esc(t)}</text>`;
    chipX += w + 14;
    return g;
  });
  const geleira = chips.some(Boolean) ? `<text x="480" y="414" font-family="${FONT}" font-size="26" fill="#ffffff" fill-opacity="0.85">Na geleira:</text>${chips.join('')}` : '';
  const initials = p.hasAvatar ? '' : `<text x="${AV.cx}" y="${AV.cy + 46}" text-anchor="middle" font-family="${FONT}" font-size="130" font-weight="700" fill="#d6334f">${esc(initialsOf(p.displayName))}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6334f"/><stop offset="1" stop-color="#ff8a5b"/></linearGradient></defs>
<rect width="${OG_W}" height="${OG_H}" fill="url(#bg)"/>
<circle cx="1120" cy="70" r="190" fill="#ffffff" fill-opacity="0.08"/><circle cx="90" cy="600" r="150" fill="#ffffff" fill-opacity="0.08"/>
<circle cx="${AV.cx}" cy="${AV.cy}" r="${AV.r + 12}" fill="#ffffff"/>
<circle cx="${AV.cx}" cy="${AV.cy}" r="${AV.r}" fill="#ffe4e8"/>${initials}
${sticker(CHAR_OF[i], 292, 372, 165, 8)}
${wordmark(510, 50, 180)}
<text x="480" y="210" font-family="${FONT}" font-size="58" font-weight="700" fill="#ffffff">${esc(name)}</text>
<text x="480" y="262" font-family="${FONT}" font-size="32" fill="#ffffff" fill-opacity="0.92">convidou-te para o Txillapp</text>
<rect x="480" y="290" width="670" height="84" rx="42" fill="#ffffff"/>
<text x="815" y="345" text-anchor="middle" font-family="${FONT}" font-size="36" font-weight="700" fill="#d6334f">${esc(PHRASES[i])}</text>
${geleira}
<text x="480" y="570" font-family="${FONT}" font-size="30" fill="#ffffff">Código <tspan font-weight="700" letter-spacing="4">${esc(p.code)}</tspan> · +${p.reward} vibes para ti</text>
</svg>`;
}

/** O PNG do cartão: o desenho mais a foto de perfil recortada em círculo. */
export async function ogCardPng(p: OgCardInput): Promise<Buffer> {
  const AV = { cx: 250, cy: 300, r: 160 };
  const layers: OverlayOptions[] = [];
  if (p.avatar) {
    try {
      const d = AV.r * 2;
      const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}"><circle cx="${AV.r}" cy="${AV.r}" r="${AV.r}" fill="#fff"/></svg>`);
      const round = await sharp(p.avatar).rotate().resize(d, d, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
      layers.push({ input: round, left: AV.cx - AV.r, top: AV.cy - AV.r });
    } catch {
      /* foto ilegível: ficam as iniciais de fundo */
    }
  }
  const svg = ogCardSvg({ ...p, hasAvatar: layers.length > 0 });
  // A foto vai por baixo do sticker: desenha-se o fundo, a foto, e por cima outra vez só o sticker.
  const base = sharp(Buffer.from(svg)).png();
  if (!layers.length) return base.toBuffer();
  const top = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}">${sticker(CHAR_OF[phraseIndexOf(p.code)], 292, 372, 165, 8)}</svg>`);
  return sharp(await base.toBuffer()).composite([...layers, { input: top, left: 0, top: 0 }]).png({ compressionLevel: 8 }).toBuffer();
}

/**
 * O cartão do convite («Convite que se vê»): lógica pura, sem React Native, para correr nos testes (tests/inviteCard.test.mjs).
 * Aqui escolhe-se a frase, os itens da Geleira que vão no cartão (nunca álcool se quem convida for menor), o texto de
 * partilha, o progresso e o desenho do cartão. O desenho sai em três partes, que cada aparelho pinta à sua maneira
 * (Skia no telemóvel, canvas na web; ver inviteCardImage.ts e .web.ts): um SVG de fundo sem letras, as letras (com
 * tamanho e posição) e o círculo da foto. Tudo se faz no aparelho: nada sai para fora.
 */

/** As frases do cartão, em calão da malta. A mesma lista do servidor (api/src/invites/card.ts). */
export const INVITE_PHRASES = ['Bora txilar no Txillapp, malta!', 'A tua malta já cá está', 'Traz a tua malta'] as const;
/** O Gelinho (a geleira) que acompanha cada frase, em três stickers da biblioteca. */
export const PHRASE_STICKERS = ['vem-ca', 'malta-ja', 'bue-fixe'] as const;

/** A frase de cada código (a mesma conta do servidor, para o cartão da app e o da pré-visualização baterem certo). */
export function phraseIndexOf(code: string): number {
  let h = 0;
  for (const ch of String(code ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % INVITE_PHRASES.length;
}
/** A frase seguinte (o botão «Outra frase»). */
export const nextPhrase = (i: number) => (((Math.trunc(i) || 0) % INVITE_PHRASES.length) + 1 + INVITE_PHRASES.length) % INVITE_PHRASES.length;

export type CardFormat = 'post' | 'status';
/** 4:5 para conversas e publicações; 9:16 para o Status do WhatsApp. */
export const CARD_SIZE: Record<CardFormat, { width: number; height: number }> = { post: { width: 1080, height: 1350 }, status: { width: 1080, height: 1920 } };

export interface GeleiraItemIn { name: string; kind: string; alcoholic?: boolean; favorite?: boolean }

/**
 * Os itens da Geleira que vão no cartão: 3 a 4, de tipos diferentes primeiro (uma bebida, uma comida, uma vibe…), pela ordem
 * em que chegam (favoritos primeiro, do servidor). Sem álcool se quem convida não for maior (`adult` false ou desconhecido),
 * sem nomes repetidos nem vazios. O servidor já só manda os itens da geleira pública; isto é a segunda tranca.
 */
export function pickCardItems<T extends GeleiraItemIn>(items: readonly T[] | null | undefined, opts: { adult?: boolean; max?: number } = {}): T[] {
  const max = Math.max(0, Math.min(4, Math.trunc(opts.max ?? 4)));
  const seen = new Set<string>();
  const ok = (items ?? []).filter((i) => {
    const key = String(i?.name ?? '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    if (i.alcoholic && opts.adult !== true) return false;
    seen.add(key);
    return true;
  });
  const out: T[] = [];
  const kinds = new Set<string>();
  for (const i of ok) if (out.length < max && !kinds.has(i.kind)) { out.push(i); kinds.add(i.kind); }
  for (const i of ok) if (out.length < max && !out.includes(i)) out.push(i);
  return out;
}

/** O texto que vai com a imagem (e sozinho, quando só dá para mandar texto). A ligação vai sempre no fim, numa linha só sua. */
export function inviteShareText(p: { link: string; code: string; reward: number; phrase?: number }): string {
  const phrase = INVITE_PHRASES[((Math.trunc(p.phrase ?? 0) % INVITE_PHRASES.length) + INVITE_PHRASES.length) % INVITE_PHRASES.length];
  const reward = Math.max(0, Math.trunc(Number(p.reward) || 0));
  const gift = reward > 0 ? ` e ganhas ${reward} Txills logo à entrada` : '';
  return `${phrase} Entra com o meu convite${gift}. Código: ${p.code}\n${p.link}`;
}

/** A ligação do WhatsApp com o texto já escrito: a app (whatsapp://) no telemóvel, wa.me no browser. */
export const whatsappUrl = (text: string, nativeApp: boolean) => `${nativeApp ? 'whatsapp://send?text=' : 'https://wa.me/?text='}${encodeURIComponent(text)}`;

/** «Entraram 3, 1 já te deu Txills»: o progresso no ecrã dos convites. */
export function inviteProgress(stats: { invited?: number; paid?: number } | null | undefined): string {
  const n = Math.max(0, Math.trunc(Number(stats?.invited) || 0));
  const paid = Math.min(n, Math.max(0, Math.trunc(Number(stats?.paid) || 0)));
  if (n === 0) return 'Ainda ninguém entrou com o teu convite';
  if (n === 1) return paid ? 'Entrou 1 e já te deu Txills' : 'Entrou 1, ainda não te deu Txills';
  if (paid === 0) return `Entraram ${n}, ainda nenhum te deu Txills`;
  return `Entraram ${n}, ${paid} já ${paid === 1 ? 'te deu' : 'te deram'} Txills`;
}

/** Corta um texto em `max` letras (conta acentos e emojis como uma), com reticências. */
export function fitText(text: string, max: number): string {
  const a = [...String(text ?? '').trim().replace(/\s+/g, ' ')];
  return a.length > max ? `${a.slice(0, Math.max(1, max - 1)).join('').trimEnd()}…` : a.join('');
}

/** Até duas iniciais, para quem não tem foto. */
export const initialsOf = (name: string) =>
  String(name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]?.toUpperCase() ?? '').join('') || 'T';

/** O desenho de um sticker (SVG da biblioteca) sem o invólucro: a caixa (viewBox) e o conteúdo. */
export function stickerParts(svg: string | null | undefined): { vb: [number, number, number, number]; body: string } | null {
  const s = String(svg ?? '');
  const open = /<svg\b[^>]*>/i.exec(s);
  const end = s.lastIndexOf('</svg>');
  if (!open || end < 0) return null;
  const vb = (/viewBox="([^"]+)"/i.exec(open[0])?.[1] ?? '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v)) || vb[2] <= 0 || vb[3] <= 0) return null;
  // Nada de scripts nem de ligações para fora (a biblioteca é nossa, mas fica a tranca).
  const body = s.slice(open.index + open[0].length, end).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\s(?:on\w+|href|xlink:href)="[^"]*"/gi, '');
  return { vb: vb as [number, number, number, number], body };
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Uma linha de texto do cartão. `maxWidth`: quem pinta encolhe a letra se não couber; `spacing`: espaço extra entre letras. */
export interface CardText {
  text: string;
  x: number;
  y: number;
  size: number;
  weight: 400 | 700 | 800;
  color: string;
  align: 'left' | 'center';
  alpha?: number;
  maxWidth?: number;
  spacing?: number;
  /** O selo de verificado logo a seguir ao texto (quem pinta mede o texto e põe-no ao lado, centrado na letra). */
  badge?: 'verified' | 'official';
}

/** O selo de verificado (o mesmo desenho do componente VerifiedBadge) como SVG, para os cartões pintados no aparelho. */
export function sealSvg(tier: 'verified' | 'official', size: number): string {
  const fill = tier === 'official' ? 'url(#off)' : '#1d9bf0';
  const defs = tier === 'official' ? '<defs><linearGradient id="off" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6b81"/><stop offset="1" stop-color="#d6334f"/></linearGradient></defs>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${defs}<path fill="${fill}" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z"/><path fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m8 12.4 2.8 2.8L16.4 9.4"/></svg>`;
}

/**
 * Onde vai o selo de uma linha já medida (`w` = largura do texto com a letra `size` já encolhida): ~0,9× a letra, 0,2× de
 * espaço, centrado na altura das minúsculas. Numa linha centrada, o texto e o selo centram-se juntos. Devolve onde começa o texto.
 */
export function badgePlace(t: Pick<CardText, 'x' | 'y' | 'align'>, w: number, size: number): { textX: number; x: number; y: number; size: number } {
  const s = Math.round(size * 0.9);
  const gap = Math.round(size * 0.2);
  const textX = t.align === 'center' ? t.x - (w + gap + s) / 2 : t.x;
  return { textX, x: textX + w + gap, y: Math.round(t.y - size * 0.36 - s / 2), size: s };
}

export interface CardInput {
  format: CardFormat;
  code: string;
  displayName: string;
  /** Os nomes dos itens já escolhidos (pickCardItems). */
  items: string[];
  reward: number;
  phrase: number;
  /** O SVG do sticker do Gelinho (da biblioteca), ou null. */
  stickerSvg: string | null;
  /** A matriz do QR da ligação (lib/qr.ts), ou null para não ter QR. */
  qr: boolean[][] | null;
  hasAvatar: boolean;
  /** Conta verificada: o selo a seguir ao nome (azul, ou coral na conta oficial). */
  badge?: 'verified' | 'official' | null;
}

export interface CardLayout {
  width: number;
  height: number;
  /** O fundo, o logótipo, as caixas, o sticker e o QR, sem letras (a Skia e o canvas pintam as letras por cima). */
  svg: string;
  texts: CardText[];
  avatar: { cx: number; cy: number; r: number };
  /** Rótulo para o leitor de ecrã (o que o cartão diz). */
  label: string;
}

const BRAND = '#d6334f';
const INK = '#1f1b24';

/** O logótipo em traços (a mesma geometria de lib/wordmark.ts). */
const circlePath = (cx: number, cy: number, r: number) => `M${cx + r} ${cy}a${r} ${r} 0 1 0 ${-2 * r} 0a${r} ${r} 0 1 0 ${2 * r} 0`;
const WORDMARK = ['M7 5V27Q7 34 14 34M0 14H14', 'M20 14Q27 24 34 34M34 14Q27 24 20 34', 'M42 14V34', 'M51 3V34', 'M61 3V34', circlePath(77, 24, 9.5), 'M86.5 14V34', circlePath(106, 24, 9.5), 'M96.5 14V46', circlePath(135, 24, 9.5), 'M125.5 14V46'];
function wordmarkSvg(cx: number, y: number, width: number) {
  const s = width / 154;
  const x = cx - width / 2;
  // O logótipo oficial (letras escuras, ponto do i a coral) numa pastilha branca.
  const h = 54 * s;
  const px = 0.26 * h;
  const py = 0.3 * h;
  const pill = `<rect x="${(x - px).toFixed(2)}" y="${(y - py).toFixed(2)}" width="${(width + 2 * px).toFixed(2)}" height="${(h + 2 * py).toFixed(2)}" rx="${((h + 2 * py) / 2).toFixed(2)}" fill="#ffffff"/>`;
  return `${pill}<g transform="translate(${(x + 4 * s).toFixed(2)} ${(y + 3 * s).toFixed(2)}) scale(${s.toFixed(4)})" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${WORDMARK.map((d) => `<path d="${d}"/>`).join('')}<circle cx="42" cy="3.5" r="4.2" fill="${BRAND}" stroke="none"/></g>`;
}

/** O QR como um só caminho (quadradinhos escuros), dentro do quadrado x,y,size. */
function qrSvg(m: boolean[][], x: number, y: number, size: number) {
  const n = m.length;
  if (!n) return '';
  const k = size / n;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) d += `M${c} ${r}h1v1h-1z`;
  return `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(4)})"><path d="${d}" fill="${INK}"/></g>`;
}

/** As medidas de cada formato (o Status é mais alto: tudo um pouco maior e mais espaçado). */
const GEO = {
  post: { markY: 72, markW: 210, avY: 330, avR: 140, stX: 650, stY: 236, stW: 230, nameY: 572, nameS: 66, subY: 628, subS: 38, bubY: 672, bubH: 110, phS: 50, labY: 848, chipY: 872, chipH: 70, chipS: 34, panY: 1050, panH: 250, qr: 206, codeS: 72, smallS: 30 },
  status: { markY: 160, markW: 270, avY: 560, avR: 180, stX: 690, stY: 450, stW: 290, nameY: 870, nameS: 78, subY: 936, subS: 44, bubY: 992, bubH: 132, phS: 58, labY: 1216, chipY: 1244, chipH: 82, chipS: 40, panY: 1440, panH: 300, qr: 250, codeS: 86, smallS: 34 },
} as const;

/** Largura estimada de um texto (para as pastilhas); quem pinta encolhe a letra se a conta falhar. */
const estWidth = (t: string, size: number) => [...t].length * size * 0.58;

/** O desenho do cartão. Puro: as mesmas entradas dão sempre o mesmo desenho. */
export function cardLayout(p: CardInput): CardLayout {
  const { width: W, height: H } = CARD_SIZE[p.format] ?? CARD_SIZE.post;
  const g = GEO[p.format] ?? GEO.post;
  const phrase = INVITE_PHRASES[((Math.trunc(p.phrase) % INVITE_PHRASES.length) + INVITE_PHRASES.length) % INVITE_PHRASES.length];
  const name = fitText(p.displayName || 'Alguém', 24);
  const items = p.items.map((t) => fitText(t, 18)).filter(Boolean).slice(0, 4);
  const texts: CardText[] = [];
  const parts: string[] = [];

  // Fundo: o degradê da marca e duas bolhas de luz.
  parts.push(`<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BRAND}"/><stop offset="1" stop-color="#ff8a5b"/></linearGradient></defs>`);
  parts.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`);
  parts.push(`<circle cx="${W - 60}" cy="${Math.round(H * 0.08)}" r="${Math.round(W * 0.22)}" fill="#ffffff" fill-opacity="0.08"/><circle cx="70" cy="${Math.round(H * 0.62)}" r="${Math.round(W * 0.16)}" fill="#ffffff" fill-opacity="0.08"/>`);
  parts.push(wordmarkSvg(W / 2, g.markY, g.markW));

  // A foto: anel branco e, por baixo da foto, o fundo das iniciais.
  const avatar = { cx: W / 2, cy: g.avY, r: g.avR };
  parts.push(`<circle cx="${avatar.cx}" cy="${avatar.cy}" r="${avatar.r + 12}" fill="#ffffff"/><circle cx="${avatar.cx}" cy="${avatar.cy}" r="${avatar.r}" fill="#ffe4e8"/>`);
  if (!p.hasAvatar) texts.push({ text: initialsOf(p.displayName), x: avatar.cx, y: avatar.cy + avatar.r * 0.3, size: Math.round(avatar.r * 0.85), weight: 800, color: BRAND, align: 'center' });

  // O Gelinho, encostado à foto.
  const st = stickerParts(p.stickerSvg);
  if (st) {
    const [vx, vy, vw, vh] = st.vb;
    const s = g.stW / vw;
    const h = vh * s;
    parts.push(`<g transform="rotate(8 ${g.stX + g.stW / 2} ${g.stY + h / 2}) translate(${g.stX} ${g.stY}) scale(${s.toFixed(4)}) translate(${-vx} ${-vy})">${st.body}</g>`);
  }

  texts.push({ text: name, x: W / 2, y: g.nameY, size: g.nameS, weight: 800, color: '#ffffff', align: 'center', maxWidth: W - 120 - (p.badge ? g.nameS : 0), ...(p.badge ? { badge: p.badge } : {}) });
  texts.push({ text: 'convidou-te para o Txillapp', x: W / 2, y: g.subY, size: g.subS, weight: 400, color: '#ffffff', align: 'center', alpha: 0.92, maxWidth: W - 120 });

  // A frase num balão branco. Sem itens da geleira, o balão desce um pouco para o cartão não ficar com um buraco.
  const bubY = items.length ? g.bubY : g.bubY + Math.round(g.chipH * 0.9);
  parts.push(`<rect x="90" y="${bubY}" width="${W - 180}" height="${g.bubH}" rx="${g.bubH / 2}" fill="#ffffff"/>`);
  texts.push({ text: phrase, x: W / 2, y: bubY + g.bubH / 2 + g.phS * 0.36, size: g.phS, weight: 800, color: BRAND, align: 'center', maxWidth: W - 240 });

  // Os itens da geleira em pastilhas, centradas, em uma ou duas linhas.
  if (items.length) {
    texts.push({ text: 'Na geleira', x: W / 2, y: g.labY, size: g.smallS, weight: 700, color: '#ffffff', align: 'center', alpha: 0.85 });
    const pad = Math.round(g.chipS * 0.9);
    const gap = 16;
    const maxRow = W - 160;
    const rows: { t: string; w: number }[][] = [[]];
    for (const t of items) {
      const w = Math.min(maxRow, Math.round(estWidth(t, g.chipS) + pad * 2));
      const row = rows[rows.length - 1];
      const used = row.reduce((s, c) => s + c.w + gap, 0);
      if (row.length && used + w > maxRow) {
        if (rows.length === 2) break;
        rows.push([{ t, w }]);
      } else row.push({ t, w });
    }
    rows.forEach((row, ri) => {
      const total = row.reduce((s, c) => s + c.w, 0) + gap * (row.length - 1);
      let x = (W - total) / 2;
      const y = g.chipY + ri * (g.chipH + 14);
      for (const c of row) {
        parts.push(`<rect x="${x.toFixed(1)}" y="${y}" width="${c.w}" height="${g.chipH}" rx="${g.chipH / 2}" fill="#ffffff" fill-opacity="0.22"/>`);
        texts.push({ text: c.t, x: x + c.w / 2, y: y + g.chipH / 2 + g.chipS * 0.36, size: g.chipS, weight: 700, color: '#ffffff', align: 'center', maxWidth: c.w - pad });
        x += c.w + gap;
      }
    });
  }

  // Em baixo, o cartão branco com o código e o QR.
  const panX = 60, panW = W - 120;
  parts.push(`<rect x="${panX}" y="${g.panY}" width="${panW}" height="${g.panH}" rx="40" fill="#ffffff"/>`);
  const left = panX + 50;
  const hasQr = !!p.qr?.length;
  const textW = hasQr ? panW - g.qr - 120 : panW - 100;
  if (hasQr) parts.push(qrSvg(p.qr!, panX + panW - g.qr - 22, g.panY + (g.panH - g.qr) / 2, g.qr));
  const reward = Math.max(0, Math.trunc(Number(p.reward) || 0));
  texts.push({ text: 'Entra com o meu código', x: left, y: g.panY + g.panH * 0.27, size: g.smallS, weight: 400, color: '#52525b', align: 'left', maxWidth: textW });
  texts.push({ text: p.code, x: left, y: g.panY + g.panH * 0.27 + g.codeS * 1.05, size: g.codeS, weight: 800, color: BRAND, align: 'left', spacing: Math.round(g.codeS * 0.08), maxWidth: textW });
  texts.push({ text: reward ? `+${reward} Txills para ti · txillapp.com` : 'txillapp.com', x: left, y: g.panY + g.panH * 0.84, size: g.smallS, weight: 700, color: '#3f3f46', align: 'left', maxWidth: textW });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
  const label = `Cartão de convite de ${name}: ${phrase}${items.length ? ` Na geleira: ${items.join(', ')}.` : ''} Código ${p.code}.`;
  return { width: W, height: H, svg, texts, avatar, label };
}

/** O cartão inteiro em SVG (com as letras como <text>): serve para os testes e para ver o desenho sem Skia nem canvas. */
export function cardSvgWithText(l: CardLayout, font = 'Helvetica, Arial, sans-serif'): string {
  const t = l.texts
    .map((x) => `<text x="${x.x.toFixed(1)}" y="${x.y.toFixed(1)}" font-family="${font}" font-size="${x.size}" font-weight="${x.weight}" fill="${x.color}"${x.alpha !== undefined ? ` fill-opacity="${x.alpha}"` : ''}${x.align === 'center' ? ' text-anchor="middle"' : ''}${x.spacing ? ` letter-spacing="${x.spacing}"` : ''}>${esc(x.text)}</text>`)
    .join('');
  return l.svg.replace('</svg>', `${t}</svg>`);
}

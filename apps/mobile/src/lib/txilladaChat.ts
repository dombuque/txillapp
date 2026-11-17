/**
 * A conversa da Txillada: o teclado aberto (o vídeo fica do mesmo tamanho, atrás; só a barra de comentar sobe), a lista
 * dos comentários para ler para trás («N comentários novos»), as @menções (tocáveis; quem não está a ver é convidado) e
 * os avisos. Contas puras, sem imports da app: testadas em tests/txilladaVoltar.test.mjs.
 */

// ─── O teclado ─────────────────────────────────────────────────────────────────────────────────────────────────────────

import { t } from '@/lib/i18n';
import { visibleBottom } from '@/lib/keyboardMath';

export type KbIn = {
  web: boolean;
  /** A escrever no campo (ou o teclado aberto). */
  typing: boolean;
  /** A altura do palco, medida sem o teclado (fica parada enquanto se escreve: lib/prepKeyboard `stableScreen`). */
  stageH: number;
  /** A altura de agora da janela (no Android a janela pode encolher com o teclado; no iPhone a web mede a zona visível). */
  winH: number;
  /** A zona visível da web (visualViewport), ou null. */
  vv: { top: number; height: number } | null;
  /** A altura do teclado no telemóvel (avisos do sistema); 0 na web. */
  kb: number;
  /** A margem de baixo de sempre (sem o teclado). */
  padBottom: number;
  gap?: number;
};

/**
 * Onde fica a barra de comentar: sem teclado, na margem de sempre; com ele, logo acima dele (a contar do fundo do palco,
 * que não encolhe). `visTop`/`visBottom`: a parte do palco que se vê (os comentários a flutuar não sobem acima dela).
 * A conta de até onde se vê é a mesma dos mimos e dos Zás (lib/keyboardMath `visibleBottom`).
 */
export function liveKeyboard({ web, typing, stageH, winH, vv, kb, padBottom, gap = 8 }: KbIn): { open: boolean; barBottom: number; visTop: number; visBottom: number } {
  const h = stageH || winH;
  const top = web && vv ? Math.max(0, vv.top) : 0;
  // Web sem a zona visível: o fundo é o da janela de agora. Nativo: o teclado, sem contar duas vezes o que a janela encolheu.
  const bottom = Math.min(h, visibleBottom({ web, vv: web ? vv ?? { top: 0, height: winH } : null, nowH: winH, screenH: h, kb }));
  const open = typing && bottom < h - 40;
  if (!open) return { open: false, barBottom: padBottom, visTop: 0, visBottom: h };
  return { open: true, barBottom: Math.max(padBottom, Math.ceil(h - bottom) + gap), visTop: top, visBottom: bottom };
}

/** A altura dos comentários a flutuar: a de sempre, mas nunca acima da parte que se vê (com o teclado aberto). */
export function floatHeight(base: number, o: { stageH: number; floatBottom: number; visTop: number; header: number }): number {
  const room = o.stageH - o.floatBottom - o.visTop - o.header;
  return Math.max(72, Math.min(base, Math.floor(room)));
}

// ─── A lista para ler para trás ───────────────────────────────────────────────────────────────────────────────────────

/** Está no fim da lista (com folga): os novos seguem; acima disso, ficam à espera em «N comentários novos». */
export const atEnd = (y: number, viewH: number, contentH: number, slack = 28) => y + viewH >= contentH - slack;
/** Perto do topo: carregam-se os mais antigos (se a API tiver). */
export const nearTop = (y: number, slack = 60) => y <= slack;

/** Quantos chegaram depois do último que vi (pelos ids, do mais antigo para o mais recente). */
export function newSince(ids: readonly string[], lastSeen: string | null): number {
  if (!lastSeen) return 0;
  const i = ids.lastIndexOf(lastSeen);
  return i < 0 ? 0 : ids.length - 1 - i;
}
/** «1 comentário novo», «3 comentários novos» (nada com 0). */
export function newLabel(n: number): string {
  if (!(n > 0)) return '';
  return n === 1 ? t('1 comentário novo') : t('{value} comentários novos', { value: n > 99 ? '99+' : n });
}
/** O comentário mais antigo que é mesmo um comentário (as linhas das ofertas não vão à API): o `before` de ler para trás. */
export function oldestId(list: readonly { id: string; gift?: unknown }[]): string | null {
  for (const c of list) if (!c.gift && !c.id.startsWith('gift:')) return c.id;
  return null;
}
/**
 * Depois de carregar os antigos por cima: para onde rolar para o que estava à vista não saltar (a lista cresceu `added`
 * px em cima).
 */
export const keepOffset = (y: number, beforeH: number, afterH: number) => Math.max(0, y + Math.max(0, afterH - beforeH));

// ─── As @menções ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type MentionPart = { t: 'text'; s: string } | { t: 'at'; u: string };

/** As mesmas regras do servidor e do RichText: o @ não pode vir colado a letras, e o ponto final não faz parte do nome. */
const AT = /(?<![\p{L}\p{N}_.&#@])@([a-zA-Z0-9_.]{3,30})/gu;

/** O texto partido em bocados: o texto normal e os @nomes (que abrem o perfil). */
export function mentionParts(text: string): MentionPart[] {
  const out: MentionPart[] = [];
  let last = 0;
  for (const m of text.matchAll(AT)) {
    let u = m[1];
    const trail = u.match(/\.+$/)?.[0] ?? '';
    u = u.slice(0, u.length - trail.length);
    if (u.length < 3) continue;
    const at = m.index ?? 0;
    if (at > last) out.push({ t: 'text', s: text.slice(last, at) });
    out.push({ t: 'at', u });
    last = at + 1 + u.length;
  }
  if (last < text.length) out.push({ t: 'text', s: text.slice(last) });
  return out;
}

/** `txillada.mention`: fui mencionado num comentário desta Txillada (estou a ver: não há convite, só o aviso). */
export type MentionEvent = { type: 'txillada.mention'; txilladaId: string; commentId: string | null; from: { username: string; verified: boolean; verifiedTier: string | null } };
export function parseMentionEvent(e: unknown, id?: string): MentionEvent | null {
  if (!e || typeof e !== 'object') return null;
  const x = e as { type?: unknown; txilladaId?: unknown; commentId?: unknown; from?: { username?: unknown; verified?: unknown; verifiedTier?: unknown } };
  if (x.type !== 'txillada.mention' || typeof x.txilladaId !== 'string' || (id && x.txilladaId !== id)) return null;
  const u = x.from?.username;
  if (typeof u !== 'string' || !u) return null;
  const tier = x.from?.verifiedTier;
  return {
    type: 'txillada.mention', txilladaId: x.txilladaId, commentId: typeof x.commentId === 'string' ? x.commentId : null,
    from: { username: u, verified: x.from?.verified === true, verifiedTier: typeof tier === 'string' ? tier : null },
  };
}
export const mentionNotice = (from: string) => t('@{from} mencionou-te num comentário', { from });
/** Depois de comentar: quem recebeu o convite para vir ver (não estava a ver). */
export function invitedNotice(users: readonly string[] | null | undefined): string | null {
  const u = (users ?? []).filter((x) => typeof x === 'string' && x);
  if (!u.length) return null;
  if (u.length === 1) return t('Convidaste @{u} para vir ver a Txillada', { u: u[0] });
  return t('Convidaste {n} pessoas para vir ver a Txillada', { n: u.length });
}

/** Por baixo do nome, nas sugestões do @ (na Txillada): quem não está a ver é convidado ao mencioná-lo. */
export function suggestNote(p: { inTxillada?: boolean; invitable?: boolean }): string | null {
  if (p.inTxillada) return null;
  return p.invitable ? t('Convida-se ao mencionar') : null;
}

// ─── A câmara ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** O que diz o quadrado de quem desligou a câmara (o som continua). */
export const CAM_OFF = () => t('Câmara desligada');
export const camLabel = (on: boolean) => (on ? t('Desligar a câmara') : t('Ligar a câmara'));

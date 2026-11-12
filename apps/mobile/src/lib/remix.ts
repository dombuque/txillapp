// Remix das tchekas (lógica pura, sem React): o «Dueto» e o «Responder com tcheka». As ligações do estúdio, os textos
// («Dueto com @x»), para onde leva cada coisa, a montagem lado a lado e onde fica o autocolante do comentário.
// Sem dependências (os testes correm em Node: tests/remix.test.mjs). Servidor: apps/api/src/posts/remix.ts (0134).

export type RemixKind = 'duet' | 'reply';
export interface RemixPerson { username: string; displayName: string; hasAvatar?: boolean; verified?: boolean; verifiedTier?: 'verified' | 'official' | 'paid' | null }
/** A ligação do remix numa publicação (`post.remixOf`). */
export interface RemixOf {
  postId: string;
  kind: RemixKind;
  commentId: string | null;
  sticker: { x: number; y: number } | null;
  /** O original ainda se vê (apagado, privado ou com bloqueio: a tcheka fica, sem a ligação). */
  available: boolean;
  code: string | null;
  author: RemixPerson | null;
  comment: { id: string; body: string; author: RemixPerson } | null;
}
/** O que o pedido de publicação leva (`remixOf` em POST /posts). */
export interface RemixInput { postId: string; kind: RemixKind; commentId?: string; sticker?: { x: number; y: number } }

/** O estúdio: /tcheka/nova?dueto=<postId> e /tcheka/nova?resposta=<commentId>. */
export const duetHref = (postId: string) => `/tcheka/nova?dueto=${encodeURIComponent(postId)}`;
export const replyHref = (commentId: string) => `/tcheka/nova?resposta=${encodeURIComponent(commentId)}`;
/** A lista «Duetos e respostas» de uma publicação. */
export const remixesHref = (postId: string) => `/remixes/${encodeURIComponent(postId)}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Que estúdio abre: os parâmetros do /tcheka/nova (ids inválidos não abrem nada; o dueto ganha à resposta). */
export function remixMode(params: { dueto?: string | string[]; resposta?: string | string[] }): { kind: 'duet'; postId: string } | { kind: 'reply'; commentId: string } | null {
  const d = one(params.dueto);
  if (d && UUID.test(d)) return { kind: 'duet', postId: d.toLowerCase() };
  const r = one(params.resposta);
  if (r && UUID.test(r)) return { kind: 'reply', commentId: r.toLowerCase() };
  return null;
}

/** «Dueto com @ana» / «Resposta a @rui» / original que já não se vê. */
export function remixLabel(r: RemixOf | null | undefined): string | null {
  if (!r) return null;
  if (!r.available || !r.author) return r.kind === 'duet' ? 'Dueto com uma tcheka que já não está disponível' : 'Resposta a um comentário que já não está disponível';
  if (r.kind === 'duet') return `Dueto com @${r.author.username}`;
  return r.comment ? `Resposta a @${r.comment.author.username}` : `Resposta numa tcheka de @${r.author.username}`;
}

/** Para onde leva tocar na etiqueta ou no autocolante: o original (na resposta, aberto no comentário). */
export function remixTarget(r: RemixOf | null | undefined): string | null {
  if (!r || !r.available) return null;
  if (r.kind === 'reply' && r.commentId) return `/p/${r.postId}?comments=1&c=${r.commentId}`;
  return `/p/${r.postId}`;
}

/** O que mostrar no botão «Remix» de uma publicação (dueto só nas tchekas e se o dono deixa; a lista se já houver algum). */
export function remixActions(p: { canRemix?: boolean; remixes?: number; media: { kind?: string }[] }) {
  const tcheka = p.media.length === 1 && p.media[0]?.kind === 'video';
  const duet = tcheka && p.canRemix === true;
  const list = (p.remixes ?? 0) > 0;
  return { duet, list, count: p.remixes ?? 0, show: duet || list };
}

/** «3 duetos e respostas». */
export const remixCount = (n: number) => (n === 1 ? '1 dueto ou resposta' : `${n.toLocaleString('pt-PT')} duetos e respostas`);

/** No comentário: «Respondeu com uma tcheka» (ou «3 tchekas responderam»). */
export const tchekaRepliesLabel = (n: number) => (n <= 1 ? 'Respondeu com uma tcheka' : `${n} tchekas responderam`);

/** Quanto se grava num dueto: o tempo do original, no máximo 60 s (sem duração conhecida, 60 s). */
export const duetLimitMs = (originalMs: number | null | undefined) => Math.min(60_000, originalMs && originalMs > 0 ? originalMs : 60_000);

export interface Rect { x: number; y: number; w: number; h: number }
/**
 * A montagem lado a lado num vídeo 9:16 (W×H): duas metades, cada uma com um quadro 9:16 ao meio (faixas pretas por cima e
 * por baixo, como no dueto do TikTok). A câmara à esquerda, o original à direita.
 */
export function duetLayout(W: number, H: number): { left: Rect; right: Rect } {
  const w = W / 2;
  const h = Math.min(H, (w * 16) / 9);
  const y = (H - h) / 2;
  return { left: { x: 0, y, w, h }, right: { x: w, y, w, h } };
}

/** Desenhar uma imagem sw×sh a encher a caixa (corta o que sobra, ao centro). */
export function coverRect(sw: number, sh: number, box: Rect): Rect {
  if (!sw || !sh) return box;
  const k = Math.max(box.w / sw, box.h / sh);
  const w = sw * k, h = sh * k;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/** O autocolante (de tamanho sw×sh, em fração do vídeo) fica sempre todo dentro do vídeo. */
export function clampSticker(x: number, y: number, sw: number, sh: number): { x: number; y: number } {
  const c = (v: number, max: number) => Math.round(Math.min(Math.max(0, Number.isFinite(v) ? v : 0), Math.max(0, max)) * 1000) / 1000;
  return { x: c(x, 1 - sw), y: c(y, 1 - sh) };
}
/** Onde o autocolante começa (em cima à esquerda, longe dos botões do lado). */
export const STICKER_START = { x: 0.06, y: 0.16 } as const;

/** O texto do comentário no autocolante: uma linha limpa e curta (os stickers [sticker:id] e GIF viram uma palavra). */
export function stickerText(body: string, max = 90): string {
  const t = (body ?? '').trim();
  if (!t) return 'GIF';
  if (/^\[sticker:[a-z0-9-]+\]$/.test(t)) return 'Sticker';
  const flat = t.replace(/\s+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** O aviso nas notificações (data do servidor: remixKind, role). */
export function remixVerb(d: { remixKind?: string; role?: string }): string {
  if (d.remixKind === 'duet') return 'fez um dueto com a tua tcheka';
  return d.role === 'comment' ? 'respondeu ao teu comentário com uma tcheka' : 'respondeu com uma tcheka a um comentário na tua publicação';
}
/** Abre a tcheka de quem fez o remix. */
export const remixNoticeTarget = (d: { postId?: string }) => (d.postId ? `/p/${d.postId}` : null);

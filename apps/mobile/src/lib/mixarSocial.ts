/**
 * Mixar, social e guardados (docs/mixar-contrato.md, «Social e guardados»): a lógica pura (sem React nem módulos nativos;
 * os testes em tests/mixarSocial.test.mjs importam este ficheiro diretamente). Os textos seguem as regras da app: português
 * de Moçambique/Portugal, sem emojis nem travessões. O nome do outro vai sem artigo («Zeca está a ver contigo»), como no
 * resto do Mixar («Visto por Ana»), porque a app não sabe se é «o» ou «a».
 */
import type { MixarReactionId } from './api.mixar';

/** O tamanho máximo de um comentário (o mesmo da API). */
export const COMMENT_MAX = 500;
/** De quanto em quanto tempo a app repete «estou aqui» (a presença vale 45 s no servidor). */
export const PRESENCE_EVERY_MS = 20_000;
/** Quanto dura a animação da reação do outro a subir. */
export const BURST_MS = 1400;
/** Quantos «Mais 5» por dia (o mesmo da API). */
export const MORE_PER_DAY = 3;

/* ---------- Conversa do item ---------- */

/** O que fica no botão do carril: o número (até 99+) ou nada. */
export const commentBadge = (n: number | null | undefined): string | null => (!n || n < 0 ? null : n > 99 ? '99+' : String(n));

export function commentA11y(n: number | null | undefined, partner: string): string {
  const c = n && n > 0 ? `, ${n} ${n === 1 ? 'comentário' : 'comentários'}` : '';
  return `Conversa com ${partner} sobre este vídeo${c}`;
}

/** Quantos caracteres faltam; `show` só perto do fim (como no chat). */
export function commentLeft(text: string): { left: number; show: boolean; over: boolean } {
  const left = COMMENT_MAX - text.trim().length;
  return { left, show: left <= 100, over: left < 0 };
}

export const canSend = (text: string, busy = false) => !busy && text.trim().length > 0 && text.trim().length <= COMMENT_MAX;

/** O texto de um erro ao comentar (422: o filtro de texto recusou). */
export function commentErrorText(e: unknown): string {
  const x = e as { status?: number; message?: string } | null;
  if (x?.status === 422) return x.message?.trim() || 'Este comentário não cumpre as regras do Txillapp.';
  if (x?.status === 404) return 'Este vídeo já não está no Mixar.';
  if (x?.status === 429) return 'Estás a escrever muito depressa. Espera um bocadinho.';
  return 'Não consegui enviar. Tenta outra vez.';
}

export const commentsEmpty = (partner: string) => ({ title: 'Ainda não há conversa', line: `Diz a ${partner} o que achaste deste vídeo. Só vocês os dois veem isto.` });

/* ---------- Ver juntos ---------- */

export interface Presence { here: boolean; postId: string | null }

export const togetherLine = (partner: string) => `${partner} está a ver contigo`;
export const hereLine = (partner: string) => `${partner} está aqui`;

/** A linha de baixo do «está a ver contigo»: no mesmo item, noutro (dá para ir lá) ou ainda a abrir. */
export function togetherSub(p: Presence | null | undefined, myPostId: string | null, known: readonly string[]): { text: string; jump: string | null } {
  if (!p?.here) return { text: '', jump: null };
  if (p.postId && p.postId === myPostId) return { text: 'No mesmo vídeo que tu', jump: null };
  if (p.postId && known.includes(p.postId)) return { text: 'Noutro vídeo. Toca para ir', jump: p.postId };
  return { text: 'Acabou de abrir o Mixar', jump: null };
}

/** Junta um evento de presença ao estado (o eco dos meus outros aparelhos não conta). */
export function applyPresence(prev: Presence, e: { what?: string; here?: boolean; postId?: string | null; self?: boolean }): Presence {
  if (e.what !== 'presence' || e.self) return prev;
  return e.here ? { here: true, postId: e.postId ?? null } : { here: false, postId: null };
}

/**
 * As reações do outro que mudaram desde a última vez (para a animação a subir): só as que passaram a existir ou trocaram,
 * nunca na primeira leitura (`prev` vazio). Devolve também o mapa novo.
 */
export function theirChanges(prev: ReadonlyMap<string, MixarReactionId | null> | null, items: readonly { post: { id: string }; theirs: MixarReactionId | null }[]): { changes: { postId: string; reaction: MixarReactionId }[]; next: Map<string, MixarReactionId | null> } {
  const next = new Map<string, MixarReactionId | null>();
  const changes: { postId: string; reaction: MixarReactionId }[] = [];
  for (const it of items) {
    next.set(it.post.id, it.theirs);
    if (!prev || !prev.has(it.post.id)) continue;
    const was = prev.get(it.post.id) ?? null;
    if (it.theirs && it.theirs !== was) changes.push({ postId: it.post.id, reaction: it.theirs });
  }
  return { changes, next };
}

/* ---------- Guardados ---------- */

/** Os dois reagiram sem ser com «nah»: o item entra sozinho nos Guardados (o servidor faz o mesmo). */
export const autoSaves = (mine: MixarReactionId | null | undefined, theirs: MixarReactionId | null | undefined) => !!mine && !!theirs && mine !== 'nah' && theirs !== 'nah';

export function savedByText(by: 'me' | 'them' | 'both', partner: string): string {
  if (by === 'me') return 'Guardaste tu';
  if (by === 'them') return `Guardado por ${partner}`;
  return 'Os dois reagiram';
}

export const saveA11y = (saved: boolean) => (saved ? 'Tirar dos Guardados do Mixar' : 'Guardar nos Guardados do Mixar');
export const SAVED_TOAST = { saved: 'Ficou nos vossos Guardados', removed: 'Saiu dos Guardados', both: 'Os dois reagiram: ficou nos vossos Guardados' };

export const savedEmpty = (partner: string) => ({
  title: 'Ainda não há Guardados',
  line: `Quando tu e ${partner} reagirem ao mesmo vídeo (sem ser com nah), ele fica aqui. Também podes guardar à mão no marcador.`,
});
export const savedEnd = { title: 'São todos os vossos Guardados', line: 'Continuem a reagir no Mixar para a coleção crescer.' };

/* ---------- «Mais 5» ---------- */

export function moreLine(left: number | null | undefined): string {
  if (left == null) return '';
  if (left <= 0) return 'Hoje já não dá para pedir mais.';
  return `Podes pedir mais ${left} ${left === 1 ? 'vez' : 'vezes'} hoje`;
}

export function moreResult(added: number): string {
  if (added <= 0) return 'Por agora não há mais nada novo. Volta amanhã.';
  return `${added} ${added === 1 ? 'vídeo novo' : 'vídeos novos'} na vossa seleção`;
}

export function moreErrorText(e: unknown): string {
  const x = e as { status?: number; message?: string } | null;
  if (x?.status === 429) return x.message?.trim() && !/throttler|too many/i.test(x.message) ? x.message.trim() : 'Já pediram mais 3 vezes hoje. Amanhã às 05:00 há uma seleção nova';
  return 'Não deu agora. Tenta outra vez.';
}

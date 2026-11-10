/**
 * Quem vê e quem entra num TxillGroup (lógica pura, sem React nem rede: testada em tests/groupAccess.test.mjs).
 * Três modos, escolhidos por um administrador:
 * - Privado (por omissão): só entra quem um administrador adicionar; não aparece no mapa.
 * - Privado, visível no mapa (`showOnMap`): aparece em "À tua volta"; quem não está no grupo pede e um administrador aprova.
 * - Público (`visibility = 'public'`): aparece sempre no mapa e qualquer pessoa entra logo.
 * Em todos, as conversas e o resto ficam só para quem está no grupo.
 */
export type GroupVisibility = 'private' | 'public';
export type GroupAccess = 'private' | 'map' | 'public';
export type JoinMode = 'open' | 'request';
/** A minha relação com um grupo visto de fora. */
export type JoinState = 'none' | 'pending' | 'member';

export const ACCESS_OPTIONS: { id: GroupAccess; title: string; text: string }[] = [
  { id: 'private', title: 'Privado', text: 'Só entra quem um administrador adicionar. Não aparece no mapa.' },
  { id: 'map', title: 'Privado, visível no mapa', text: 'Aparece em À tua volta com o nome, a capa, a foto e o plano. Quem quiser entrar pede e um administrador aprova.' },
  { id: 'public', title: 'Público', text: 'Aparece em À tua volta e qualquer pessoa pode entrar logo. As conversas ficam só para quem está no grupo.' },
];

/** O modo de um grupo a partir do que o servidor manda (sem campos = privado, como no servidor antigo). */
export function accessOf(g: { visibility?: GroupVisibility | null; showOnMap?: boolean | null } | null | undefined): GroupAccess {
  if (g?.visibility === 'public') return 'public';
  return g?.showOnMap ? 'map' : 'private';
}

/** O corpo do PATCH para um modo (o público aparece sempre no mapa). */
export function accessBody(a: GroupAccess): { visibility: GroupVisibility; showOnMap: boolean } {
  return a === 'public' ? { visibility: 'public', showOnMap: true } : { visibility: 'private', showOnMap: a === 'map' };
}

/** O que diz o estado a quem não administra. */
export function accessLabel(a: GroupAccess): string {
  return a === 'public' ? 'Grupo público' : a === 'map' ? 'Grupo privado, visível no mapa' : 'Grupo privado';
}

/** Como se entra: o servidor diz `joinMode`; sem ele, deduz-se da visibilidade. */
export function joinModeOf(g: { joinMode?: JoinMode | null; visibility?: GroupVisibility | null } | null | undefined): JoinMode {
  return g?.joinMode ?? (g?.visibility === 'public' ? 'open' : 'request');
}

export type JoinAction = 'open' | 'join' | 'request' | 'cancel';
/** O botão da página pública (e da folha do mapa) conforme o modo e a minha relação com o grupo. */
export function joinButton(mode: JoinMode, me: JoinState): { action: JoinAction; label: string } {
  if (me === 'member') return { action: 'open', label: 'Abrir conversa' };
  if (me === 'pending') return { action: 'cancel', label: 'Pedido enviado · Cancelar' };
  return mode === 'open' ? { action: 'join', label: 'Entrar no grupo' } : { action: 'request', label: 'Pedir para entrar' };
}

/** Aviso para o administrador: um grupo no mapa precisa de um local no Plano para ter onde aparecer. */
export function mapWarning(a: GroupAccess, planHasVenue: boolean | null): string | null {
  if (a === 'private' || planHasVenue !== false) return null;
  return 'O Plano ainda não tem local: o grupo só aparece em À tua volta depois de escolheres um local no Plano.';
}

/**
 * O grupo de uma notificação (group_join_request, group_join_accepted, group_member_joined). Vem em `data.groupId/groupName`
 * como nas outras notificações de grupo; aceita-se também ao nível de cima, caso o servidor o mande aí.
 */
export function notifGroup(n: { data?: { groupId?: string; groupName?: string } | null; groupId?: string; groupName?: string }): { id: string | null; name: string } {
  const id = n.data?.groupId ?? n.groupId ?? null;
  const name = n.data?.groupName ?? n.groupName ?? '';
  return { id, name: name || 'um TxillGroup' };
}

/** Para onde leva cada notificação de grupo: o pedido abre os detalhes (onde estão os pedidos); as outras, a conversa. */
export function notifGroupTarget(kind: string, groupId: string | null): string | null {
  if (!groupId) return null;
  const base = `/messages/g/${encodeURIComponent(groupId)}`;
  return kind === 'group_join_request' ? `${base}?info=1` : base;
}

/** Mostrar a secção "Pedidos para entrar": quando o grupo está no mapa a pedido, ou ainda há pedidos por responder. */
export function showRequests(a: GroupAccess, pending: number | null | undefined): boolean {
  return a === 'map' || (pending ?? 0) > 0;
}

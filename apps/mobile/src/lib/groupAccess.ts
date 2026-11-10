/**
 * Quem vê e quem entra num TxillGroup (lógica pura, sem React nem rede: testada em tests/groupAccess.test.mjs).
 * Três modos, escolhidos por um administrador:
 * - Privado (por omissão): só entra quem um administrador adicionar; não aparece no mapa.
 * - Privado, visível no mapa (`showOnMap`): aparece em "À tua volta"; quem não está no grupo pede e um administrador aprova.
 * - Público (`visibility = 'public'`): aparece sempre no mapa e qualquer pessoa entra logo.
 * Em todos, as conversas e o resto ficam só para quem está no grupo; quem entra (seja como for) vê o que já lá foi partilhado.
 * Os dois modos do mapa precisam de um sítio (o local do Plano ou um ponto marcado no mapa): ver "onde é o grupo" mais abaixo.
 * Mudar de modo nunca grava ao primeiro toque: escolhe-se, "Guardar", e confirma-se com as consequências (`accessChange`).
 */
export type GroupVisibility = 'private' | 'public';
export type GroupAccess = 'private' | 'map' | 'public';
export type JoinMode = 'open' | 'request';
/** A minha relação com um grupo visto de fora. */
export type JoinState = 'none' | 'pending' | 'member';

export const ACCESS_OPTIONS: { id: GroupAccess; title: string; text: string }[] = [
  { id: 'private', title: 'Privado', text: 'Só entra quem um administrador adicionar. Não aparece no mapa.' },
  { id: 'map', title: 'Privado, visível no mapa', text: 'Aparece em À tua volta com o nome, a capa, a foto e o plano. Quem quiser entrar pede e um administrador aprova.' },
  { id: 'public', title: 'Público', text: 'Aparece em À tua volta e qualquer pessoa pode entrar logo. Quem entra vê o que já foi partilhado no grupo.' },
];

const titleOf = (a: GroupAccess) => ACCESS_OPTIONS.find((o) => o.id === a)!.title;

/** O que muda ao passar de um modo para outro: o resumo (por baixo das opções) e a confirmação (título, consequências e sugestão). */
export interface AccessChange { title: string; summary: string; lines: string[]; hint?: string }

/**
 * As consequências concretas de passar de `from` para `to`; `pending` = pedidos para entrar à espera. null se não muda nada.
 * `place` = o sítio onde o grupo aparece no mapa (o nome, ou null se for um ponto sem nome); `changed` = escolheu-se agora um
 * sítio novo (então há confirmação mesmo sem mudar de modo). No modo Privado o sítio não conta.
 */
export function accessChange(from: GroupAccess, to: GroupAccess, pending?: number | null, place?: { label: string | null; changed?: boolean } | null): AccessChange | null {
  const where = place && to !== 'private' ? placeLine(place.label) : null;
  if (from === to) {
    if (!where || !place?.changed) return null;
    return { title: 'Mudar o sítio do grupo?', summary: where, lines: [where, PRIVACY_NOTE] };
  }
  const withPlace = (c: AccessChange): AccessChange => (where ? { ...c, summary: `${c.summary} ${where}`, lines: [where, ...c.lines] } : c);
  const n = Math.max(0, pending ?? 0);
  const passa = `Passa de ${titleOf(from)} para ${titleOf(to)}.`;
  if (to === 'public') {
    return withPlace({
      title: 'Tornar o grupo público?',
      summary: `${passa} Qualquer pessoa vai poder entrar sem aprovação.`,
      lines: ['Qualquer pessoa pode entrar sem aprovação e, ao entrar, vê as mensagens, o álbum e as despesas que já existem no grupo.'],
      hint: from === 'map' ? 'Se preferires aprovar quem entra, mantém Privado, visível no mapa.' : 'Se preferires aprovar quem entra, escolhe Privado, visível no mapa.',
    });
  }
  if (to === 'private') {
    const declined = n === 0 ? null : n === 1 ? 'O pedido para entrar à espera vai ser recusado.' : `Os ${n} pedidos para entrar à espera vão ser recusados.`;
    return {
      title: 'Tornar o grupo privado?',
      summary: [passa, 'Deixa de aparecer em À tua volta.', declined].filter(Boolean).join(' '),
      lines: ['O grupo deixa de aparecer em À tua volta e quem não está no grupo deixa de o encontrar.', ...(declined ? [declined] : [])],
    };
  }
  const fromPublic = from === 'public';
  return withPlace({
    title: fromPublic ? 'Passar a aprovar quem entra?' : 'Mostrar o grupo no mapa?',
    summary: `${passa} ${fromPublic ? 'Passa a ser preciso aprovar quem entra.' : 'Passa a aparecer em À tua volta.'}`,
    lines: [
      'Aparece em À tua volta com o nome, a capa, a foto e o plano. Quem quiser entrar pede e um administrador aprova.',
      ...(fromPublic ? ['A partir de agora é preciso aprovar quem entra.'] : []),
    ],
  });
}

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

// ----- onde é o grupo (o sítio no mapa) -----
/**
 * Um grupo em "À tua volta" (Privado visível no mapa ou Público) tem sempre um sítio: o local do Plano (um local do Txillapp)
 * ou um ponto marcado no mapa, que o servidor arredonda a ~500 m. O servidor diz se já há sítio em `mapReady`.
 */
export interface MapPlace { lat: number; lng: number; label?: string | null }
/** O sítio escolhido no ecrã e ainda por gravar. */
export type PlaceChoice = { kind: 'venue'; slug: string; name: string } | { kind: 'point'; lat: number; lng: number; label: string | null };

export const PLACE_LABEL_MAX = 80;
export const PRIVACY_NOTE = 'Guardamos só a zona aproximada (cerca de 500 m), nunca o ponto exato.';

/**
 * Se o grupo já tem sítio no mapa. O servidor diz em `mapReady`; o servidor antigo não o manda e então conta um ponto
 * marcado (`mapPlace`) ou o local do Plano (`planHasVenue`, null enquanto o Plano não chega).
 */
export function mapReadyOf(g: { mapReady?: boolean | null; mapPlace?: MapPlace | null } | null | undefined, planHasVenue?: boolean | null): boolean {
  if (typeof g?.mapReady === 'boolean') return g.mapReady;
  return !!g?.mapPlace || planHasVenue === true;
}

/** Pedir o passo "Onde é o grupo?": o modo marcado aparece no mapa, o grupo ainda não tem sítio e ainda não se escolheu um. */
export function needsPlace(to: GroupAccess, mapReady: boolean, choice: PlaceChoice | null | undefined): boolean {
  return to !== 'private' && !mapReady && !choice;
}

/** "Guardar" ativo: há alguma coisa para gravar (outro modo, ou um sítio novo num modo do mapa) e, se o modo for no mapa, há sítio. */
export function canSave(from: GroupAccess, to: GroupAccess, mapReady: boolean, choice: PlaceChoice | null | undefined): boolean {
  const changes = from !== to || (!!choice && to !== 'private');
  return changes && !needsPlace(to, mapReady, choice);
}

/** O nome do sítio para mostrar: o escolhido agora, senão o gravado (ponto com nome, senão o local do Plano). null = ponto sem nome. */
export function placeName(choice: PlaceChoice | null | undefined, saved: { mapPlace?: MapPlace | null; venueName?: string | null }): string | null {
  if (choice) return choice.kind === 'venue' ? choice.name : cleanPlaceLabel(choice.label ?? '') || null;
  return cleanPlaceLabel(saved.mapPlace?.label ?? '') || saved.venueName?.trim() || null;
}

/** A frase do sítio na confirmação. */
export function placeLine(label: string | null | undefined): string {
  const l = cleanPlaceLabel(label ?? '');
  return l ? `Aparece em À tua volta em ${l}.` : 'Aparece em À tua volta na zona que marcaste no mapa.';
}

/** O nome do sítio escrito à mão: sem espaços a mais e até 80 caracteres. */
export function cleanPlaceLabel(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, PLACE_LABEL_MAX).trim();
}

/**
 * O `mapPlace` do PATCH para um ponto marcado: 3 casas decimais (~100 m; o servidor arredonda ainda mais, a ~500 m), para o
 * ponto exato (que pode ser onde a pessoa está) nunca sair do aparelho. Sem nome, não vai `label`.
 */
export function mapPlaceBody(c: { lat: number; lng: number; label?: string | null }): MapPlace {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const label = cleanPlaceLabel(c.label ?? '');
  return label ? { lat: r(c.lat), lng: r(c.lng), label } : { lat: r(c.lat), lng: r(c.lng) };
}

/**
 * O PATCH de "Guardar": o modo e, num modo do mapa com sítio escolhido agora, o `mapPlace` no mesmo pedido. Escolher o local
 * do Plano apaga o ponto marcado (`mapPlace: null`), para o grupo passar a aparecer no local (o Plano grava-se antes, à parte).
 */
export function saveBody(to: GroupAccess, choice: PlaceChoice | null | undefined): ReturnType<typeof accessBody> & { mapPlace?: MapPlace | null } {
  const b = accessBody(to);
  if (!choice || to === 'private') return b;
  return { ...b, mapPlace: choice.kind === 'point' ? mapPlaceBody(choice) : null };
}

/** O 400 do servidor por faltar o sítio ("Escolhe onde é o grupo…"): volta a mostrar o passo "Onde é o grupo?". */
export function isNeedPlaceError(e: { status?: number; message?: string } | null | undefined): boolean {
  return e?.status === 400 && /onde é o grupo/i.test(e.message ?? '');
}

/**
 * O grupo de uma notificação (group_join_request, group_join_accepted, group_member_joined, group_admin_granted). Vem em `data.groupId/groupName`
 * como nas outras notificações de grupo; aceita-se também ao nível de cima, caso o servidor o mande aí.
 */
export function notifGroup(n: { data?: { groupId?: string; groupName?: string } | null; groupId?: string; groupName?: string }): { id: string | null; name: string } {
  const id = n.data?.groupId ?? n.groupId ?? null;
  const name = n.data?.groupName ?? n.groupName ?? '';
  return { id, name: name || 'um TxillGroup' };
}

/**
 * Para onde leva cada notificação de grupo: o pedido e o "fez-te administrador" abrem os detalhes (pedidos, quem vê e quem
 * entra, membros); as outras, a conversa.
 */
export function notifGroupTarget(kind: string, groupId: string | null): string | null {
  if (!groupId) return null;
  const base = `/messages/g/${encodeURIComponent(groupId)}`;
  return kind === 'group_join_request' || kind === 'group_admin_granted' ? `${base}?info=1` : base;
}

/** Mostrar a secção "Pedidos para entrar": quando o grupo está no mapa a pedido, ou ainda há pedidos por responder. */
export function showRequests(a: GroupAccess, pending: number | null | undefined): boolean {
  return a === 'map' || (pending ?? 0) > 0;
}

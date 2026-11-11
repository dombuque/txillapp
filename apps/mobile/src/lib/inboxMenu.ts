/**
 * As ações de uma linha da lista de Mensagens (uma conversa a dois ou um TxillGroup), como no WhatsApp e no Instagram.
 * A lógica pura, sem dependências (os testes correm em Node: tests/inboxMenu.test.mjs). Os três caminhos mostram as
 * mesmas ações e correm as mesmas funções (em app/(tabs)/messages.tsx):
 * - deslizar a linha (components/SwipeRow): para a direita marca como lida ou por ler, para a esquerda apaga ou sai;
 * - segurar a linha (ou o botão direito do rato, na web): a folha com o nome e a foto em cima e as ações por baixo;
 * - o leitor de ecrã (`accessibilityActions`): as mesmas ações e "Mais opções", que abre a folha.
 *
 * Silenciar e afixar conversas ainda não existem na API (apps/api/src/chat): quando existirem, entram aqui.
 */

export type InboxAction = 'read' | 'unread' | 'profile' | 'delete' | 'info' | 'leave';

/** O que a linha precisa de saber para escolher as ações. */
export interface InboxMenuRow {
  /** TxillGroup (cartão) ou conversa a dois. */
  group: boolean;
  /** Por ler (numa conversa marcada à mão como por ler conta 1). */
  unread: number;
  /** Conversa a dois: o @ do outro lado. Sem ele a linha não tem ações. */
  username?: string;
  /** O meu @ (sem sessão não se sai de um TxillGroup). */
  me?: string | null;
}

export interface InboxMenuItem {
  id: InboxAction | 'cancel';
  label: string;
  /** Nome de um ícone de components/Icon. */
  icon: 'check' | 'mail' | 'user' | 'trash' | 'info' | 'logout' | 'x';
  /** Vermelho: apaga ou sai (pergunta antes). */
  danger: boolean;
}

/** A ação do leitor de ecrã que abre a folha. `longpress` é a ação padrão do Android (manter premido). */
export const MORE_ACTION = 'longpress';

const ICON: Record<InboxAction, InboxMenuItem['icon']> = { read: 'check', unread: 'mail', profile: 'user', delete: 'trash', info: 'info', leave: 'logout' };
const DANGER: Record<InboxAction, boolean> = { read: false, unread: false, profile: false, delete: true, info: false, leave: true };

/** O texto curto do botão que aparece ao deslizar (cabe em 84 px). */
const SWIPE_LABEL: Record<InboxAction, string> = { read: 'Lida', unread: 'Por ler', profile: 'Perfil', delete: 'Apagar', info: 'Info', leave: 'Sair' };

/** O texto inteiro (folha e leitor de ecrã). "Lida" de uma conversa, "lido" de um grupo. */
export function actionLabel(a: InboxAction, group: boolean): string {
  switch (a) {
    case 'read': return group ? 'Marcar como lido' : 'Marcar como lida';
    case 'unread': return 'Marcar como por ler';
    case 'profile': return 'Ver perfil';
    case 'delete': return 'Apagar conversa';
    case 'info': return 'Info do grupo';
    case 'leave': return 'Sair do grupo';
  }
}

export const swipeLabel = (a: InboxAction) => SWIPE_LABEL[a];
export const actionIcon = (a: InboxAction) => ICON[a];

/**
 * Deslizar: para a direita (`left`) marca como lida, ou como por ler se já estiver lida; para a esquerda (`right`) apaga a
 * conversa. Num TxillGroup: para a direita só há "lido" se houver por ler ("por ler" não existe para grupos) e para a
 * esquerda sai do grupo (apagar não existe para grupos).
 */
export function inboxSwipe(r: InboxMenuRow): { left: InboxAction[]; right: InboxAction[] } {
  if (r.group) return { left: r.unread > 0 ? ['read'] : [], right: r.me ? ['leave'] : [] };
  if (!r.username) return { left: [], right: [] };
  return { left: [r.unread > 0 ? 'read' : 'unread'], right: ['delete'] };
}

/** Segurar: as ações da folha, pela ordem em que aparecem (sem o "Cancelar", que a folha tem sempre no fim). */
export function inboxMenu(r: InboxMenuRow): InboxAction[] {
  const s = inboxSwipe(r);
  if (r.group) return [...s.left, 'info', ...s.right];
  if (!r.username) return [];
  return [...s.left, 'profile', ...s.right];
}

/** A folha inteira: as ações e o "Cancelar" no fim. */
export function inboxMenuItems(r: InboxMenuRow): InboxMenuItem[] {
  return [
    ...inboxMenu(r).map((a): InboxMenuItem => ({ id: a, label: actionLabel(a, r.group), icon: ICON[a], danger: DANGER[a] })),
    { id: 'cancel', label: 'Cancelar', icon: 'x', danger: false },
  ];
}

/** O leitor de ecrã: as mesmas ações da folha e "Mais opções", que a abre. Nomes livres, não são `accessibilityRole`. */
export function inboxA11yActions(r: InboxMenuRow): { name: string; label: string }[] {
  const acts = inboxMenu(r);
  if (!acts.length) return [];
  return [...acts.map((a) => ({ name: a, label: actionLabel(a, r.group) })), { name: MORE_ACTION, label: 'Mais opções' }];
}

/**
 * Web: o `contextmenu` abre a folha? O botão direito do rato abre-a sempre. Num ecrã de toque o Android também o manda
 * ao segurar: se a folha já abriu pelo temporizador (`held`) ou ainda vai abrir (`pending`), não abre outra vez; se o
 * temporizador foi cancelado mas o browser ainda achou que era segurar, abre (o dedo tremeu pouco).
 */
export function contextMenuOpens(msSinceTouch: number, held: boolean, pending: boolean): boolean {
  if (msSinceTouch >= 1500) return true;
  return !held && !pending;
}

/** O nome que o leitor de ecrã mandou, de volta para a ação (ou "more" para abrir a folha; null se não for nosso). */
export function a11yToAction(name: string, r: InboxMenuRow): InboxAction | 'more' | null {
  if (name === MORE_ACTION) return inboxMenu(r).length ? 'more' : null;
  return (inboxMenu(r) as string[]).includes(name) ? (name as InboxAction) : null;
}

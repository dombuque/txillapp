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

export type InboxAction = 'read' | 'unread' | 'profile' | 'delete' | 'info' | 'leave' | 'ttl' | 'clear' | 'mixar';

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
  /** Conversa a dois que ainda é um pedido de mensagem (aí não se mudam as mensagens temporárias). */
  request?: boolean;
  /** Conversa a dois: mostrar «Mixar com Fulano» (abre o Mixar que já existe ou convida; não num pedido). */
  mixar?: boolean;
  /** O nome do outro lado («Mixar com Ana»: só o primeiro nome). */
  name?: string;
}

export interface InboxMenuItem {
  id: InboxAction | 'cancel';
  label: string;
  /** Nome de um ícone de components/Icon. */
  icon: 'check' | 'mail' | 'user' | 'trash' | 'info' | 'logout' | 'x' | 'clock' | 'comment-off' | 'mixar';
  /** Vermelho: apaga ou sai (pergunta antes). */
  danger: boolean;
}

/** A ação do leitor de ecrã que abre a folha. `longpress` é a ação padrão do Android (manter premido). */
export const MORE_ACTION = 'longpress';

const ICON: Record<InboxAction, InboxMenuItem['icon']> = { read: 'check', unread: 'mail', profile: 'user', delete: 'trash', info: 'info', leave: 'logout', ttl: 'clock', clear: 'comment-off', mixar: 'mixar' };
const DANGER: Record<InboxAction, boolean> = { read: false, unread: false, profile: false, delete: true, info: false, leave: true, ttl: false, clear: true, mixar: false };

/** O texto curto do botão que aparece ao deslizar (cabe em 84 px). */
const SWIPE_LABEL: Record<InboxAction, string> = { read: 'Lida', unread: 'Por ler', profile: 'Perfil', delete: 'Apagar', info: 'Info', leave: 'Sair', ttl: 'Temporárias', clear: 'Limpar', mixar: 'Mixar' };

/** O texto inteiro (folha e leitor de ecrã). "Lida" de uma conversa, "lido" de um grupo. `name`: «Mixar com Ana». */
export function actionLabel(a: InboxAction, group: boolean, name?: string): string {
  switch (a) {
    case 'read': return group ? 'Marcar como lido' : 'Marcar como lida';
    case 'unread': return 'Marcar como por ler';
    case 'profile': return 'Ver perfil';
    case 'delete': return 'Apagar conversa';
    case 'info': return 'Info do grupo';
    case 'leave': return 'Sair do grupo';
    case 'ttl': return 'Mensagens temporárias';
    case 'clear': return 'Limpar conversa';
    case 'mixar': {
      const first = (name ?? '').trim().split(/\s+/)[0];
      return first ? `Mixar com ${first}` : 'Mixar';
    }
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

/**
 * A folha inteira (segurar a linha): todas as opções, as mesmas do menu do computador, e o "Cancelar" no fim. Desde a
 * 1.44 a lista não tem ações de deslizar (o deslize fica para mudar de ecrã): tudo o que havia nos deslizes está aqui.
 */
export function inboxMenuItems(r: InboxMenuRow): InboxMenuItem[] {
  return [
    ...inboxDeskMenu(r).map((a): InboxMenuItem => ({ id: a, label: actionLabel(a, r.group, r.name), icon: ICON[a], danger: DANGER[a] })),
    { id: 'cancel', label: 'Cancelar', icon: 'x', danger: false },
  ];
}

/**
 * Computador (o "⋯" ao passar o rato e o botão direito): o menu de contexto, sem deslizar. As ações da folha e, numa
 * conversa a dois, também as da conversa aberta que fazem sentido na lista: Mensagens temporárias (não num pedido) e
 * Limpar conversa. "Apagar conversa" fica no fim, a vermelho. Fixar e Silenciar ainda não existem na API.
 */
export function inboxDeskMenu(r: InboxMenuRow): InboxAction[] {
  const base = inboxMenu(r);
  if (r.group || !base.length) return base;
  const s = inboxSwipe(r);
  // «Mixar com Fulano» logo a seguir ao perfil (só quando o ecrã o pede e não num pedido de mensagem).
  const mixar = r.mixar && !r.request ? (['mixar'] as const) : [];
  return [...s.left, 'profile', ...mixar, ...(r.request ? [] : (['ttl'] as const)), 'clear', ...s.right];
}

/** O menu de contexto com os textos (sem "Cancelar": clicar fora ou Esc fecham). */
export function inboxDeskMenuItems(r: InboxMenuRow): InboxMenuItem[] {
  return inboxDeskMenu(r).map((a) => ({ id: a, label: actionLabel(a, r.group, r.name), icon: ICON[a], danger: DANGER[a] }));
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

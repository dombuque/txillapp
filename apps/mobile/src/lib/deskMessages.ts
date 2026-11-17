/**
 * Mensagens no computador (duas colunas, como o WhatsApp Web e o Instagram no computador): as medidas e as contas, sem
 * dependências (os testes correm em Node: tests/deskMessages.test.mjs). Quem as usa: components/messages/DeskMessages
 * (a coluna da lista e o painel sem conversa aberta), app/(tabs)/messages (o cabeçalho fixo), components/Notes (as setas
 * da fila das notas) e a conversa aberta (ChatList, ChatComposer, GroupComposer, ChatEditBar: a coluna legível).
 * No telemóvel nada disto corre.
 */

/** Abaixo desta largura as Mensagens são uma coluna só (a lista ou a conversa), como no telemóvel. */
export const DESK_TWO_COLUMNS_MIN = 900;

/** Ecrãs médios (até 1280 px): a lista encolhe para dar espaço à conversa. */
export const LIST_W_MEDIUM = 320;
export const LIST_W_MIN = 360;
export const LIST_W_MAX = 420;

/**
 * A largura da coluna das conversas para a largura da janela: null abaixo de 900 px (uma coluna, como no telemóvel);
 * 320 nos ecrãs médios (até 1280); de 1280 para cima cresce aos poucos de 360 até 420 (aos 1680 px).
 */
export function msgListWidth(windowW: number): number | null {
  if (!Number.isFinite(windowW) || windowW < DESK_TWO_COLUMNS_MIN) return null;
  if (windowW < 1280) return LIST_W_MEDIUM;
  return Math.round(Math.min(LIST_W_MAX, LIST_W_MIN + (windowW - 1280) * 0.15));
}

/** A largura máxima das mensagens (legível), centradas no painel da conversa. */
export const CHAT_COLUMN_MAX = 640;
/** A barra de escrever: um pouco mais larga do que as mensagens (os botões dos lados ficam por fora das bolhas). */
export const COMPOSER_MAX = 760;

/**
 * Margem dos lados (CSS, só na web) que centra um conteúdo de `max` px no pai, nunca abaixo de `min` px:
 * `max(12px, calc((100% - 640px) / 2))`. Usa-se no padding (e não em maxWidth) para o fundo e a barra de rolar
 * continuarem a ocupar o painel todo.
 */
export function deskGutter(min: number, max: number): string {
  return `max(${min}px, calc((100% - ${max}px) / 2))`;
}

/**
 * A fila das notas no computador: quantas cabem inteiras na largura e o espaço entre elas, para nenhuma ficar cortada
 * na ponta (o nome «Gerso…» cortado pela coluna). `item` é a largura de cada nota e `pad` a margem dos lados.
 */
export function notesFit(width: number, item: number, pad: number, minGap: number): { n: number; gap: number } {
  const room = Math.max(0, width - 2 * pad);
  const n = Math.max(1, Math.floor((room + minGap) / (item + minGap)));
  const gap = n > 1 ? Math.max(minGap, (room - n * item) / (n - 1)) : minGap;
  return { n, gap: Math.floor(gap * 100) / 100 };
}

/**
 * Para onde vai a fila das notas com as setas ‹ ›: uma página (as que cabem inteiras) para o lado, sempre encostada a
 * uma nota inteira, sem passar das pontas.
 */
export function notesPage(x: number, dir: 1 | -1, step: number, maxX: number): number {
  if (step <= 0 || maxX <= 0) return 0;
  const at = Math.round(x / step) * step;
  return Math.max(0, Math.min(maxX, at + dir * step));
}

/** As setas da fila: a da esquerda quando já se andou, a da direita enquanto houver mais notas para lá. */
export function notesArrows(x: number, contentW: number, boxW: number): { left: boolean; right: boolean } {
  const slack = 2;
  return { left: x > slack, right: contentW - boxW - x > slack };
}

export interface RecentChat {
  key: string;
  to: string;
  name: string;
  at: string;
  unread: number;
  group: boolean;
}

/**
 * As conversas mais recentes (a dois e TxillGroups juntos, da mais nova para a mais antiga) para o painel sem conversa
 * aberta. Os pedidos de mensagem ficam de fora (são uma visita de passagem, no separador deles).
 */
export function recentChats<D extends { username: string; displayName: string; lastMessage: { at: string }; unread?: number; request?: boolean }, G extends { id: string; name: string; lastMessage: { at: string }; unread?: number }>(
  direct: readonly D[] | null | undefined,
  groups: readonly G[] | null | undefined,
  n = 6,
): (RecentChat & { d?: D; g?: G })[] {
  const all: (RecentChat & { d?: D; g?: G })[] = [
    ...(direct ?? []).filter((c) => !c.request).map((d) => ({ key: `d:${d.username}`, to: `/messages/${d.username}`, name: d.displayName, at: d.lastMessage.at, unread: d.unread ?? 0, group: false, d })),
    ...(groups ?? []).map((g) => ({ key: `g:${g.id}`, to: `/messages/g/${g.id}`, name: g.name, at: g.lastMessage.at, unread: g.unread ?? 0, group: true, g })),
  ];
  const ms = (s: string) => { const v = Date.parse(s); return Number.isFinite(v) ? v : 0; };
  return all.sort((a, b) => ms(b.at) - ms(a.at)).slice(0, Math.max(0, n));
}

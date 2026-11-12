// Mensagens temporárias e "Limpar conversa": a lógica pura (sem React nem módulos nativos; os testes em
// tests/chatTemporary.test.mjs importam este ficheiro diretamente). Os ecrãs estão em src/components/ChatTemporary.tsx.
//
// Contrato da API (0123):
// - PUT /chat/with/:username/ttl e PUT /chat/groups/:id/ttl { ttl: 86400 | 604800 | 7776000 | null } -> { ttl }.
//   A dois muda qualquer um; nos TxillGroups só quem administra. Cada mudança deixa um aviso (kind 'system') na conversa.
// - As conversas trazem `ttl` (GET /chat/with/:username, `group.ttl` em GET /chat/groups/:id, e nas listas) e cada
//   mensagem `expiresAt` (null = fica). Passada essa hora a mensagem sai da conversa; o servidor já não a manda.
// - POST /chat/with/:username/clear e POST /chat/groups/:id/clear: limpar só para mim (a conversa fica na lista, vazia).

/** As escolhas, pela ordem do ecrã. `ttl` em segundos; null = desligadas. */
export const TTL_CHOICES: readonly { ttl: number | null; label: string }[] = [
  { ttl: null, label: 'Desligadas' },
  { ttl: 86_400, label: '24 horas' },
  { ttl: 604_800, label: '7 dias' },
  { ttl: 7_776_000, label: '90 dias' },
];

export const TTL_TITLE = 'Mensagens temporárias';

/** "Desligadas", "24 horas", "7 dias", "90 dias" (um valor desconhecido conta em dias). */
export function ttlLabel(ttl: number | null | undefined): string {
  if (!ttl) return 'Desligadas';
  return TTL_CHOICES.find((c) => c.ttl === ttl)?.label ?? `${Math.max(1, Math.round(ttl / 86_400))} dias`;
}

/** A explicação curta por baixo das escolhas (nos grupos, diz também quem pode mudar). */
export function ttlExplain(group: boolean, canChange: boolean): string {
  const base = 'As mensagens novas desaparecem para todos ao fim do tempo que escolheres. As que já lá estão ficam.';
  const who = group ? (canChange ? ' Só quem administra o TxillGroup pode mudar.' : ' Só quem administra o TxillGroup pode mudar: pede a um administrador.') : ' Qualquer um dos dois pode mudar.';
  return `${base}${who} Quem as vê pode sempre guardá-las antes.`;
}

/** O que o leitor de ecrã diz do relógio no cabeçalho (vazio se estão desligadas). */
export function ttlBadgeLabel(ttl: number | null | undefined): string {
  return ttl ? `${TTL_TITLE}: ${ttlLabel(ttl)}` : '';
}

/** A mensagem ainda existe (sem `expiresAt`, ou com ele no futuro). */
export function isLive(m: { expiresAt?: string | null }, now: number = Date.now()): boolean {
  if (!m.expiresAt) return true;
  const t = Date.parse(m.expiresAt);
  return Number.isNaN(t) || t > now;
}

/** Tira as mensagens que já expiraram (as que estão na cache do ecrã desde antes de expirarem). */
export function liveItems<T extends { expiresAt?: string | null }>(items: readonly T[], now: number = Date.now()): T[] {
  return items.every((m) => isLive(m, now)) ? (items as T[]) : items.filter((m) => isLive(m, now));
}

/** Daqui a quantos ms expira a próxima mensagem (para o ecrã a tirar na hora), ou null se nenhuma expira. */
export function nextExpiryIn(items: readonly { expiresAt?: string | null }[], now: number = Date.now()): number | null {
  let soon: number | null = null;
  for (const m of items) {
    if (!m.expiresAt) continue;
    const t = Date.parse(m.expiresAt);
    if (Number.isNaN(t) || t <= now) continue;
    if (soon === null || t < soon) soon = t;
  }
  return soon === null ? null : soon - now;
}

/** A confirmação do "Limpar conversa" (a dois e nos TxillGroups). */
export function clearPrompt(group: boolean): { title: string; message: string; confirm: string } {
  return {
    title: 'Limpar a conversa?',
    message: group ? 'As mensagens desaparecem só para ti. Os outros continuam a vê-las.' : 'As mensagens desaparecem só para ti. A outra pessoa continua a vê-las.',
    confirm: 'Limpar',
  };
}

/** A pré-visualização de uma conversa vazia porque a limpei. */
export const CLEARED_PREVIEW = 'Sem mensagens';

/**
 * A pré-visualização na lista de conversas quando não há nada para mostrar: "Sem mensagens" se a limpei; null se a
 * linha tem uma mensagem (quem chama usa a sua). `group` = { members, cleared } num TxillGroup.
 */
export function emptyPreview(last: { empty?: boolean; cleared?: boolean }, group?: { members: number }): string | null {
  if (!last.empty) return null;
  if (!group || last.cleared) return CLEARED_PREVIEW;
  return `${group.members} ${group.members === 1 ? 'pessoa' : 'pessoas'}`;
}

/** Um aviso de sistema (kind 'system'): vai ao centro, sem bolha, sem menu. */
export const isSystem = (m: { kind?: string }) => m.kind === 'system';

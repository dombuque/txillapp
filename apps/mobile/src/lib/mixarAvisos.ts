import { firstName, matchPercent } from '@/lib/mixar';

/**
 * Mixar: avisos e descoberta (0170, docs/mixar-contrato.md «Avisos e descoberta»), a lógica pura (sem React): os textos dos
 * avisos na lista de notificações, para onde levam e as sugestões «Faz um Mixar com…».
 */

/* ---------- Os avisos na lista de notificações ---------- */

export type MixarNoticeKind = 'mixar_daily' | 'mixar_pick' | 'mixar_result' | 'mixar_group';
/** `group`: o aviso é de um Mixar de grupo (0173; `name` é então o nome do grupo). */
export interface MixarNoticeData { mixarId?: string; name?: string; match?: boolean; group?: boolean; groupId?: string }

export const isMixarNotice = (kind: string): kind is MixarNoticeKind => kind === 'mixar_daily' || kind === 'mixar_pick' || kind === 'mixar_result' || kind === 'mixar_group';

/**
 * O texto depois do @ de quem (a lista põe o nome e o selo à frente): «e tu: a vossa seleção de hoje está pronta»,
 * «já escolheu no Mixa Challenge, falta tu», «também escolheu: acertaram no mesmo» / «escolheram diferente». Por baixo, o
 * nome do Mixar («Mixar Dom + Ana»).
 */
export function mixarNoticeText(kind: MixarNoticeKind, data: MixarNoticeData | null | undefined): { text: string; sub?: string } {
  // Mixar de grupo (0173): «propôs um Mixar do grupo», «e o resto do grupo: …», «também escolheu: já todos escolheram».
  const group = kind === 'mixar_group' || data?.group === true;
  const sub = data?.name ? (group ? `Mixar do grupo ${data.name}` : `Mixar ${data.name}`) : undefined;
  if (kind === 'mixar_group') return { text: 'propôs um Mixar do grupo', sub };
  if (group) {
    if (kind === 'mixar_daily') return { text: 'e o resto do grupo: a vossa seleção de hoje está pronta', sub };
    if (kind === 'mixar_pick') return { text: 'já escolheu no Mixa Challenge, falta tu', sub };
    return { text: data?.match ? 'também escolheu: escolheram todos o mesmo' : 'também escolheu: já todos escolheram', sub };
  }
  if (kind === 'mixar_daily') return { text: 'e tu: a vossa seleção de hoje está pronta', sub };
  if (kind === 'mixar_pick') return { text: 'já escolheu no Mixa Challenge, falta tu', sub };
  return { text: data?.match ? 'também escolheu: acertaram no mesmo' : 'também escolheu: escolheram diferente', sub };
}

/** Tocar abre o Mixar (se já não existir, o ecrã diz que acabou). */
export function mixarNoticeTarget(data: MixarNoticeData | null | undefined): string | null {
  const id = data?.mixarId;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? `/mixar/${id}` : null;
}

/* ---------- Sugestões «Faz um Mixar com…» ---------- */

/** «Faz um Mixar com Lina» (o primeiro nome; o selo vem a seguir, no ecrã). */
export const suggestionTitle = (displayName: string | null | undefined) => `Faz um Mixar com ${firstName(displayName)}`;

/** A linha de baixo: falam muito e quanto batem os gostos. */
export function suggestionLine(match: number | null | undefined): string {
  return `Falam muito e os gostos batem ${matchPercent(match)}%`;
}

/**
 * As sugestões a mostrar: sem quem já tem um Mixar comigo (convidei agora mesmo, ou chegou um convite), sem quem dispensei
 * nesta visita e no máximo 3.
 */
export function visibleSuggestions<T extends { username: string }>(
  items: readonly T[] | null | undefined,
  withMixar: readonly { partner: { username: string } }[] | null | undefined,
  dismissed: ReadonlySet<string> = new Set(),
  max = 3,
): T[] {
  const taken = new Set((withMixar ?? []).map((s) => s.partner.username.toLowerCase()));
  return (items ?? []).filter((s) => !taken.has(s.username.toLowerCase()) && !dismissed.has(s.username.toLowerCase())).slice(0, max);
}

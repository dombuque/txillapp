/**
 * Mixar de grupo (0173, docs/mixar-contrato.md «Mixar de grupo»): a lógica pura, sem React (os testes em
 * tests/mixar-grupo.test.mjs importam este ficheiro diretamente). Um TxillGroup de 3 a 5 pessoas junta os gostos de quem
 * aceitou; os tipos estão em lib/api.mixar.ts.
 *
 * Os nomes vão sem artigo («do gosto de Ana e Zeca», «À espera de Rui»), como no resto do Mixar.
 */
import type { MixarChallenge, MixarGroupInfo, MixarGroupItemInfo, MixarPerson, MixarSummary, MixarTopic } from '@/lib/api.mixar';
import { firstName, latestIso, mixarHasNew } from '@/lib/mixar';
import { t } from '@/lib/i18n';

export const GROUP_MIN = 3;
export const GROUP_MAX = 5;

/** Um grupo com este número de pessoas pode ter um Mixar de grupo (com mais de 5 a opção nem aparece). */
export const groupCanMixar = (members: number | null | undefined) => typeof members === 'number' && members >= GROUP_MIN && members <= GROUP_MAX;

/** «Ana», «Ana e Zeca», «Ana, Zeca e Rui» (os primeiros nomes). */
export function joinNames(names: readonly string[]): string {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n[0] ?? '';
  return `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}`;
}
export const firstNames = (people: readonly Pick<MixarPerson, 'displayName'>[] | null | undefined) => (people ?? []).map((p) => firstName(p.displayName));

/** Os outros participantes (sem mim), pela ordem de entrada. */
export function othersOf(g: Pick<MixarGroupInfo, 'people'> | null | undefined, me: string | null | undefined): MixarPerson[] {
  return (g?.people ?? []).filter((p) => p.username !== me);
}

/**
 * De quem é o gosto que trouxe o item: «do gosto de todos», «do gosto de Ana e Zeca», «do teu gosto e de Ana», «do teu
 * gosto». Com tema, à frente: «Música, do gosto de Ana e Zeca». Sem gosto de ninguém: «Escolhido para o grupo».
 */
export function groupReasonText(g: Pick<MixarGroupItemInfo, 'fans' | 'mine' | 'everyone'> | null | undefined, topic: MixarTopic | null | undefined): string {
  const label = topic?.label?.trim();
  const names = joinNames(firstNames(g?.fans));
  let whose: string;
  if (!g) whose = '';
  else if (g.everyone) whose = t('do gosto de todos');
  else if (g.mine && names) whose = t('do teu gosto e de {names}', { names });
  else if (g.mine) whose = t('do teu gosto');
  else if (names) whose = t('do gosto de {names}', { names });
  else whose = '';
  if (!whose) return label ? t('{label}, para o grupo', { label }) : t('Escolhido para o grupo');
  return label ? `${label}, ${whose}` : `${whose[0].toUpperCase()}${whose.slice(1)}`;
}

/** O ícone pequeno ao lado da razão: todos, só eu, ou outros. */
export const groupReasonIcon = (g: Pick<MixarGroupItemInfo, 'fans' | 'mine' | 'everyone'> | null | undefined): 'users' | 'user' | 'heart' =>
  !g || g.everyone || (g.mine && g.fans.length > 0) ? 'users' : g.mine ? 'user' : 'heart';

/** «Visto por Ana», «Visto por Ana e Zeca», «Visto por todos» (todos os outros). */
export function groupSeenText(seenBy: readonly Pick<MixarPerson, 'displayName'>[] | null | undefined, others: number): string | null {
  const n = seenBy?.length ?? 0;
  if (!n) return null;
  if (others > 1 && n >= others) return t('Visto por todos');
  return t('Visto por {joinNames}', { joinNames: joinNames(firstNames(seenBy)) });
}

/* ---------- Convite e entrada ---------- */

export interface GroupInviteView {
  /** 'join': posso entrar; 'waiting': estou e falta gente para começar; 'full': já tem 5. */
  tone: 'join' | 'waiting' | 'full';
  title: string;
  line: string;
}

/** «Faltam 2 pessoas» / «Falta 1 pessoa». */
export const needLabel = (n: number) => (t('Falta {count} pessoa', { count: n, other: 'Faltam {count} pessoas' }));

/**
 * O que mostra quem abre um Mixar de grupo em que ainda não está (ou em que está, à espera de gente para começar).
 * `proposedBy` sem artigo: «Ana propôs um Mixar do grupo».
 */
export function groupInviteView(s: Pick<MixarSummary, 'status' | 'invitedByMe'> & { group: Pick<MixarGroupInfo, 'myState' | 'canJoin' | 'need' | 'people' | 'proposedBy' | 'groupName'> }): GroupInviteView {
  const g = s.group;
  const inIt = g.myState === 'in';
  const names = joinNames(firstNames(g.people));
  if (inIt && s.status === 'pending') {
    return { tone: 'waiting', title: t('{needLabel} para começar', { needLabel: needLabel(g.need) }), line: t('O Mixar de {groupName} começa quando {groupMin} pessoas entrarem. Já estão: {names}.', { groupName: g.groupName, groupMin: GROUP_MIN, names }) };
  }
  if (!g.canJoin) return { tone: 'full', title: t('Este Mixar já está cheio'), line: t('Já tem {groupMax} pessoas: {names}.', { groupMax: GROUP_MAX, names }) };
  const by = g.proposedBy ? firstName(g.proposedBy.displayName) : null;
  const title = s.status === 'pending' ? (by ? t('{by} propôs um Mixar do grupo', { by }) : t('Mixar do grupo')) : t('O Mixar de {groupName} está a andar', { groupName: g.groupName });
  const who = names ? (s.status === 'pending' ? (' ' + t('Já estão: {names}.', { names })) : (' ' + t('Estão lá: {names}.', { names }))) : '';
  const line = s.status === 'pending'
    ? t('Um feed do grupo com os gostos de quem entrar. Começa com {groupMin} pessoas.{who}', { groupMin: GROUP_MIN, who })
    : t('Entra para veres a seleção de hoje com o grupo. Os teus gostos só contam se entrares.{who}', { who });
  return { tone: 'join', title, line };
}

/** A linha de baixo de um Mixar de grupo na lista /mixar. */
export function groupSummaryLine(s: Pick<MixarSummary, 'status' | 'newToday' | 'challengePending'> & { group: Pick<MixarGroupInfo, 'myState' | 'need' | 'people'> }): string {
  const g = s.group;
  if (g.myState !== 'in') return s.status === 'pending' ? t('Propuseram um Mixar do grupo') : t('{n} pessoas no Mixar. Entra quando quiseres', { n: g.people.length });
  if (s.status === 'pending') return t('{needLabel} para começar', { needLabel: needLabel(g.need) });
  const parts: string[] = [];
  if (s.newToday > 0) parts.push(t('{count} novo hoje', { count: s.newToday, other: '{count} novos hoje' }));
  if (s.challengePending) parts.push(t('Mixa Challenge à tua espera'));
  return parts.length ? parts.join(' · ') : t('Tudo visto por hoje');
}

/**
 * A bolinha azul de um Mixar de grupo (no cabeçalho do grupo, na linha do grupo nas Mensagens e na lista): um convite por
 * responder (ainda não disse nada), ou, se estou, as novidades de hoje; some depois de abrir (openedAt do servidor ou o que
 * este aparelho viu), como no Mixar a dois.
 */
export function groupShowDot(s: (Pick<MixarSummary, 'status' | 'invitedByMe' | 'newToday' | 'challengePending' | 'updatedAt' | 'openedAt'> & { group: Pick<MixarGroupInfo, 'myState'> }) | null | undefined, seenAt?: string | null): boolean {
  if (!s) return false;
  const g = s.group;
  const fresh = g.myState === null ? true : g.myState === 'in' ? mixarHasNew({ ...s, status: 'active', invitedByMe: true }) && s.status === 'active' : false;
  if (!fresh) return false;
  const seen = latestIso(s.openedAt, seenAt);
  return !seen || !s.updatedAt || seen < s.updatedAt;
}

/** O Mixar de grupo deste grupo na lista (/mixar `groups`), ou null. */
export function mixarOfGroup<T extends { group: Pick<MixarGroupInfo, 'groupId'> }>(groups: readonly T[] | null | undefined, groupId: string | null | undefined): T | null {
  return (groups ?? []).find((s) => s.group.groupId === groupId) ?? null;
}

/** O texto de um erro ao propor o Mixar do grupo (409 com `id` trata-se à parte: abre o que já existe). */
export function groupProposeError(e: unknown): string {
  const x = e as { status?: number; message?: string } | null;
  if (x?.status === 409) return x.message || t('O Mixar de grupo é para grupos de {groupMin} a {groupMax} pessoas', { groupMin: GROUP_MIN, groupMax: GROUP_MAX });
  if (x?.status === 429) return t('Já propuseste o Mixar deste grupo muitas vezes hoje. Tenta amanhã');
  if (x?.status === 404) return t('Este grupo já não existe.');
  return t('Não deu agora. Tenta outra vez.');
}

/* ---------- Mixa Challenge em grupo ---------- */

/**
 * A linha por baixo da pergunta no grupo: escolher («Escolhe um. O resultado abre quando todos escolherem»), à espera
 * («Já escolheram 2 de 3») ou o resultado («Escolheram todos o mesmo» / «Vê quantos escolheram cada um»).
 */
export function groupChallengeLine(c: Pick<MixarChallenge, 'myPick' | 'match'> & { group: { picked: number; total: number; counts: unknown[] | null } }): { phase: 'pick' | 'waiting' | 'result'; line: string } {
  const g = c.group;
  if (g.counts) return { phase: 'result', line: c.match ? t('Escolheram todos o mesmo!') : t('Vê quantos escolheram cada um') };
  if (!c.myPick) return { phase: 'pick', line: g.picked ? t('Já escolheram {picked} de {total}. Agora tu!', { picked: g.picked, total: g.total }) : t('Escolhe um. O resultado abre quando todos escolherem.') };
  return { phase: 'waiting', line: t('Já escolheram {picked} de {total}', { picked: g.picked, total: g.total }) };
}

/** «1 escolheu» / «2 escolheram» (no resultado, em cada opção). */
export const pickedLabel = (n: number) => (t('{count} escolheu', { count: n, other: '{count} escolheram' }));

/** Quantos escolheram esta opção (só no resultado), ou null. */
export function countOf(c: { group?: { counts: { postId: string; n: number }[] | null } | null }, postId: string): number | null {
  const x = c.group?.counts?.find((k) => k.postId === postId);
  return c.group?.counts ? x?.n ?? 0 : null;
}

/* ---------- Social e Guardados no grupo ---------- */

/** Nos Guardados do grupo: «Guardaste tu», «Guardado por Ana», «A maioria reagiu». */
export function groupSavedByText(by: 'me' | 'them' | 'both', person: Pick<MixarPerson, 'displayName'> | null | undefined): string {
  if (by === 'me') return t('Guardaste tu');
  if (by === 'them') return person ? t('Guardado por {firstName}', { firstName: firstName(person.displayName) }) : t('Guardado no grupo');
  return t('A maioria reagiu');
}

export const GROUP_SAVED_EMPTY = {
  get title() { return t('Ainda não há Guardados'); },
  get line() { return t('Quando a maioria do grupo reagir ao mesmo vídeo (sem ser com nah), ele fica aqui. Também podes guardar à mão no marcador.'); },
};

/** Os textos da conversa de um item no Mixar do grupo (só quem está no Mixar a vê). */
export const GROUP_COMMENTS = {
  get private() { return t('Só quem está no Mixar do grupo vê isto'); },
  get placeholder() { return t('Escreve ao grupo…'); },
  get remove() { return t('Deixa de se ver para todos no Mixar do grupo.'); },
  empty: { get title() { return t('Ainda não há conversa'); }, get line() { return t('Diz ao grupo o que achaste deste vídeo. Só quem está no Mixar do grupo vê isto.'); } },
};

/** Sair do Mixar do grupo (continuo no grupo). */
export function groupLeaveText(peopleIn: number): { title: string; line: string } {
  return {
    title: t('Sair do Mixar do grupo?'),
    line: peopleIn - 1 < GROUP_MIN
      ? t('Continuas no grupo. Com menos de {groupMin} pessoas, o Mixar acaba para todos.', { groupMin: GROUP_MIN })
      : t('Continuas no grupo e podes voltar a entrar enquanto o Mixar durar.'),
  };
}

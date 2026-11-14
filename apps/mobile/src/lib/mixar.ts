/**
 * Mixar (o feed a dois): a lógica pura, sem React nem módulos nativos (os testes em tests/mixar.test.mjs importam este
 * ficheiro diretamente). O contrato com a API está em docs/mixar-contrato.md; os tipos em lib/api.mixar.ts.
 *
 * Os nomes vão sem artigo («Porque Ana gosta…», «À espera de Ana»): a API não diz se é «o» ou «a», e assim lê-se bem
 * para toda a gente.
 */
import type { ChatMixar, MixarChallenge, MixarFrom, MixarItem, MixarReactionId, MixarSummary, MixarTopic } from './api.mixar';

/* ---------- Nomes ---------- */

/** O primeiro nome («Ana Maria» → «Ana»); sem nome, «a outra pessoa». */
export function firstName(displayName: string | null | undefined): string {
  const f = (displayName ?? '').trim().split(/\s+/)[0];
  return f || 'a outra pessoa';
}

/* ---------- Reações exclusivas ---------- */

export interface MixarReaction { id: MixarReactionId; emoji: string; label: string }

/**
 * As seis reações, pela ordem da barra. O «brinde» desenha-se com o ícone dos brindes da app (sem copo de álcool, como
 * no resto: os menores também usam o Mixar); as outras com o emoji.
 */
export const MIXAR_REACTIONS: readonly MixarReaction[] = [
  { id: 'kkk', emoji: '😂', label: 'Kkk' },
  { id: 'fogo', emoji: '🔥', label: 'Fogo' },
  { id: 'amor', emoji: '😍', label: 'Amor' },
  { id: 'uau', emoji: '😮', label: 'Uau' },
  { id: 'brinde', emoji: '🙌', label: 'Brinde' },
  { id: 'nah', emoji: '🙄', label: 'Nah' },
];

export const reactionOf = (id: string | null | undefined): MixarReaction | null => MIXAR_REACTIONS.find((r) => r.id === id) ?? null;

/** Tocar numa reação: a mesma outra vez tira-a (manda `null`); outra troca. */
export function nextReaction(current: MixarReactionId | null, tapped: MixarReactionId): MixarReactionId | null {
  return current === tapped ? null : tapped;
}

/** O que o leitor de ecrã diz de um botão da barra. */
export function reactionA11y(r: MixarReaction, mine: boolean, theirs: boolean, partner: string): string {
  const who = mine && theirs ? `tu e ${partner}` : mine ? 'tu' : theirs ? partner : '';
  return `${r.label}${who ? ` (${who})` : ''}${mine ? '. Toca para tirar' : ''}`;
}

/* ---------- A razão de cada item ---------- */

/** «Porque gostas de Música» / «Porque Ana gosta de Futebol» / «Os dois gostam de Comédia». */
export function reasonText(from: MixarFrom, topic: MixarTopic | null | undefined, partner: string): string {
  const label = topic?.label?.trim();
  if (!label) {
    if (from === 'me') return 'Escolhido pelos teus gostos';
    if (from === 'them') return `Escolhido pelos gostos de ${partner}`;
    return 'Escolhido para os dois';
  }
  if (from === 'me') return `Porque gostas de ${label}`;
  if (from === 'them') return `Porque ${partner} gosta de ${label}`;
  return `Os dois gostam de ${label}`;
}

/** O ícone pequeno ao lado da razão. */
export const reasonIcon = (from: MixarFrom): 'user' | 'heart' | 'users' => (from === 'me' ? 'user' : from === 'them' ? 'heart' : 'users');

/* ---------- O match e os temas ---------- */

/** 0–100, sempre inteiro (a API pode mandar fora dos limites ou com casas decimais). */
export function matchPercent(n: number | null | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** O texto curto do match no cabeçalho. */
export function matchLabel(n: number | null | undefined): string {
  return `${matchPercent(n)}% de match`;
}

/** Uma frase para o match (na Descoberta de interesses). */
export function matchLine(n: number | null | undefined): string {
  const p = matchPercent(n);
  if (p >= 80) return 'Almas gémeas do feed';
  if (p >= 60) return 'Batem muito bem';
  if (p >= 40) return 'Têm bastante em comum';
  if (p >= 20) return 'Gostos diferentes, boas descobertas';
  return 'Mundos diferentes: vão descobrir muita coisa';
}

/** «1 dia» / «3 dias». */
export const daysLabel = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`;
/** «1 vez» / «4 vezes». */
export const timesLabel = (n: number) => `${n} ${n === 1 ? 'vez' : 'vezes'}`;

/* ---------- O cartão do chat (kind 'mixar') ---------- */

export type MixarCardAction = 'accept' | 'decline' | 'open';
export interface MixarCardState {
  /** 'invite': recebi e posso responder; 'waiting': convidei e espero; 'active': está a andar; 'off': recusado ou terminado; 'gone': já não existe. */
  tone: 'invite' | 'waiting' | 'active' | 'off' | 'gone';
  title: string;
  /** Texto pequeno por baixo (ou o selo do estado). */
  line: string;
  actions: MixarCardAction[];
}

export const CARD_ACTION_LABEL: Record<MixarCardAction, string> = { accept: 'Aceitar', decline: 'Agora não', open: 'Abrir o Mixar' };

/** O que o cartão mostra, para quem convidou e para quem recebeu, em cada estado (sempre o atual). */
export function mixarCardState(m: ChatMixar | null | undefined, partner: string): MixarCardState {
  if (!m) return { tone: 'gone', title: 'Mixar', line: 'Este Mixar já não existe', actions: [] };
  switch (m.status) {
    case 'pending':
      return m.invitedByMe
        ? { tone: 'waiting', title: 'Convidaste para um Mixar', line: `À espera de ${partner}`, actions: [] }
        : { tone: 'invite', title: `${partner} convidou-te para um Mixar`, line: 'Um feed só vosso, com o que os dois curtem. Novo todos os dias.', actions: ['accept', 'decline'] };
    case 'active':
      return { tone: 'active', title: m.name || 'O vosso Mixar', line: 'O vosso Mixar está ativo', actions: ['open'] };
    case 'declined':
      return { tone: 'off', title: 'Mixar', line: m.invitedByMe ? 'Este convite já não está ativo' : 'Recusaste este Mixar', actions: [] };
    case 'ended':
    default:
      return { tone: 'off', title: m.name || 'Mixar', line: 'Este Mixar terminou', actions: [] };
  }
}

/** A última mensagem 'mixar' na lista das conversas (o texto é sempre para quem o vê). */
export function mixarPreview(m: { fromMe: boolean }): string {
  return m.fromMe ? 'Convidaste para um Mixar' : 'Convidou-te para um Mixar';
}

/* ---------- Sinais: quando mandar /seen ---------- */

/** Menos do que isto no ecrã é passar à frente: não conta como visto (e não se manda nada). */
export const SEEN_MIN_MS = 1000;
/** Teto do tempo mandado (um vídeo esquecido a repetir não vale horas). */
export const SEEN_MAX_MS = 10 * 60 * 1000;

export interface SeenPayload { postId: string; watchedMs: number; done: boolean }

/**
 * No máximo um /seen por item e por visita. Uma visita começa quando o item fica em cena (`enter`) e acaba quando sai
 * (`leave`). Pelo meio, o vídeo pode chegar ao fim (`done`): manda-se logo com `done: true` e o resto da visita já não
 * manda nada (nem as repetições, nem a saída). Sem fim, manda-se à saída, se ficou pelo menos SEEN_MIN_MS.
 * Voltar ao mesmo item é outra visita.
 */
export function createSeenTracker(minMs = SEEN_MIN_MS) {
  const visits = new Map<string, { sent: boolean }>();
  const payload = (postId: string, ms: number, done: boolean): SeenPayload => ({ postId, watchedMs: Math.max(0, Math.min(SEEN_MAX_MS, Math.round(ms))), done });
  return {
    /** O item ficou em cena: começa uma visita nova. */
    enter(postId: string) {
      visits.set(postId, { sent: false });
    },
    /** O vídeo chegou ao fim (a primeira vez; as repetições não mandam outra vez). */
    done(postId: string, ms: number): SeenPayload | null {
      const v = visits.get(postId);
      if (!v || v.sent) return null;
      v.sent = true;
      return payload(postId, ms, true);
    },
    /** O item saiu de cena (deslizou, mudou de item ou fechou o ecrã). */
    leave(postId: string, ms: number): SeenPayload | null {
      const v = visits.get(postId);
      if (!v) return null;
      visits.delete(postId);
      if (v.sent || !(ms >= minMs)) return null;
      return payload(postId, ms, false);
    },
  };
}
export type SeenTracker = ReturnType<typeof createSeenTracker>;

/* ---------- Mixa Challenge ---------- */

export type ChallengePhase = 'pick' | 'waiting' | 'result';
export interface ChallengeView {
  phase: ChallengePhase;
  /** A linha por baixo da pergunta. */
  line: string;
  /** Só no resultado. */
  match: boolean | null;
}

/** As perguntas fixas (a API manda `question`; isto é o recurso se vier vazia). */
export const CHALLENGE_QUESTION: Record<MixarChallenge['kind'], string> = {
  mais_engracado: 'Qual é o mais engraçado?',
  mais_txilado: 'Qual tem mais vibe?',
  partilhavas: 'Qual mandavas ao grupo?',
  repetias: 'Qual vias outra vez?',
};
export const challengeQuestion = (c: Pick<MixarChallenge, 'kind' | 'question'>) => c.question?.trim() || CHALLENGE_QUESTION[c.kind] || 'Qual escolhes?';

/** Em que fase está o desafio e o que se diz: escolher, à espera do outro, ou o resultado. */
export function challengeView(c: Pick<MixarChallenge, 'myPick' | 'theirPicked' | 'theirPick' | 'match'>, partner: string): ChallengeView {
  if (!c.myPick) {
    return { phase: 'pick', line: c.theirPicked ? `${partner} já escolheu. Agora tu!` : `Escolhe um. ${partner} só vê a tua escolha depois de escolher.`, match: null };
  }
  if (c.theirPick == null || c.match == null) return { phase: 'waiting', line: `À espera de ${partner}…`, match: null };
  return c.match
    ? { phase: 'result', line: 'Escolheram o mesmo! 🎉', match: true }
    : { phase: 'result', line: `${partner} escolheu esta`, match: false };
}

/** O selo de uma miniatura: a minha escolha, a do outro (só no resultado) ou as duas. */
export function optionBadge(c: Pick<MixarChallenge, 'myPick' | 'theirPick' | 'match'>, postId: string): 'mine' | 'theirs' | 'both' | null {
  const mine = c.myPick === postId;
  const theirs = c.match != null && c.theirPick === postId;
  return mine && theirs ? 'both' : mine ? 'mine' : theirs ? 'theirs' : null;
}

/** Escolher só quando ainda não escolhi (a escolha não se muda). */
export const canPick = (c: Pick<MixarChallenge, 'myPick'> | null | undefined) => !!c && !c.myPick;

/* ---------- As páginas do feed ---------- */

export type MixarPage = { kind: 'challenge'; key: string } | { kind: 'item'; key: string; item: MixarItem } | { kind: 'end'; key: string };

/**
 * As páginas do feed vertical: o desafio do dia primeiro (se houver), depois os itens (sem repetir publicações) e, quando
 * já não há mais, o fim da seleção do dia.
 */
export function buildPages(challenge: MixarChallenge | null | undefined, items: readonly MixarItem[], hasMore: boolean): MixarPage[] {
  const pages: MixarPage[] = [];
  if (challenge && challenge.options?.length) pages.push({ kind: 'challenge', key: `c:${challenge.id}` });
  const seen = new Set<string>();
  for (const it of items) {
    if (!it?.post?.id || seen.has(it.post.id)) continue;
    seen.add(it.post.id);
    pages.push({ kind: 'item', key: `i:${it.post.id}`, item: it });
  }
  if (!hasMore) pages.push({ kind: 'end', key: 'end' });
  return pages;
}

/* ---------- O fim da seleção do dia ---------- */

/** A seleção nova sai às 05:00 de Maputo (UTC+2, sem hora de verão). */
export const REFRESH_HOUR = 5;
const MAPUTO_OFFSET_H = 2;

/** Quando chega a próxima seleção: hoje (se ainda não são 05:00 em Maputo) ou amanhã, sempre às 05:00. */
export function nextRefresh(now: Date = new Date()): { when: 'hoje' | 'amanhã'; at: string } {
  const h = (now.getUTCHours() + MAPUTO_OFFSET_H) % 24;
  return { when: h < REFRESH_HOUR ? 'hoje' : 'amanhã', at: `${String(REFRESH_HOUR).padStart(2, '0')}:00` };
}

/** «Volta amanhã para mais» e a hora da próxima seleção. */
export function endOfDay(now: Date = new Date()): { title: string; line: string } {
  const r = nextRefresh(now);
  return r.when === 'amanhã'
    ? { title: 'Volta amanhã para mais', line: `Viste a seleção de hoje. A próxima chega amanhã às ${r.at}.` }
    : { title: 'Volta daqui a pouco para mais', line: `Viste esta seleção. A próxima chega hoje às ${r.at}.` };
}

/* ---------- A lista dos meus Mixar e o acesso nas Mensagens ---------- */

/** «1 novo hoje» / «5 novos hoje». */
export const newTodayLabel = (n: number) => `${n} ${n === 1 ? 'novo' : 'novos'} hoje`;

/** A linha de baixo de um Mixar na lista. */
export function summaryLine(s: Pick<MixarSummary, 'status' | 'invitedByMe' | 'newToday' | 'challengePending'>, partner: string): string {
  if (s.status === 'pending') return s.invitedByMe ? `À espera de ${partner}` : 'Convidou-te para um Mixar';
  const parts: string[] = [];
  if (s.newToday > 0) parts.push(newTodayLabel(s.newToday));
  if (s.challengePending) parts.push('Mixa Challenge à tua espera');
  return parts.length ? parts.join(' · ') : 'Tudo visto por hoje';
}

/** Os ativos primeiro, depois os convites que recebi, depois os que mandei; dentro de cada um, o mais recente primeiro. */
export function sortSummaries<T extends Pick<MixarSummary, 'status' | 'invitedByMe' | 'updatedAt'>>(items: readonly T[]): { active: T[]; received: T[]; sent: T[] } {
  const by = (a: T, b: T) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);
  return {
    active: items.filter((s) => s.status === 'active').sort(by),
    received: items.filter((s) => s.status === 'pending' && !s.invitedByMe).sort(by),
    sent: items.filter((s) => s.status === 'pending' && s.invitedByMe).sort(by),
  };
}

/**
 * O acesso nas Mensagens: só aparece com Mixar ou convites (senão fica uma dica pequena). `line` diz o mais importante
 * primeiro: convites por responder, desafio, novos de hoje; senão quantos há.
 */
export function inboxEntry(items: readonly Pick<MixarSummary, 'status' | 'invitedByMe' | 'newToday' | 'challengePending'>[] | null | undefined): { show: boolean; line: string; hot: boolean } {
  const list = items ?? [];
  if (!list.length) return { show: false, line: 'Junta os teus gostos com alguém: abre uma conversa e toca em «Mixar».', hot: false };
  const invites = list.filter((s) => s.status === 'pending' && !s.invitedByMe).length;
  const active = list.filter((s) => s.status === 'active');
  const challenges = active.filter((s) => s.challengePending).length;
  const fresh = active.reduce((n, s) => n + Math.max(0, s.newToday || 0), 0);
  if (invites) return { show: true, line: invites === 1 ? '1 convite por responder' : `${invites} convites por responder`, hot: true };
  if (challenges) return { show: true, line: challenges === 1 ? 'Mixa Challenge à tua espera' : `${challenges} Mixa Challenges à tua espera`, hot: true };
  if (fresh) return { show: true, line: newTodayLabel(fresh), hot: true };
  if (!active.length) return { show: true, line: list.length === 1 ? 'Convite enviado' : `${list.length} convites enviados`, hot: false };
  return { show: true, line: active.length === 1 ? 'O vosso feed a dois' : `${active.length} feeds a dois`, hot: false };
}

/* ---------- Erros ---------- */

/** O texto para um erro de convidar, aceitar ou abrir (409 trata-se à parte: abre o Mixar que já existe). */
export function mixarErrorText(e: unknown, fallback = 'Não deu agora. Tenta outra vez.'): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 403) return 'Não podes fazer um Mixar com esta pessoa (as mesmas regras das mensagens).';
  if (status === 404) return 'Este Mixar já não existe.';
  if (status === 429) return 'Chegaste ao limite: até 10 convites por dia e 20 Mixar ativos. Tenta mais tarde.';
  return fallback;
}

/** 409 ao convidar: o id do Mixar que já existe com essa pessoa (ou null se não for isso). */
export function existingMixarId(e: unknown): string | null {
  const x = e as { status?: number; extra?: { id?: unknown } } | null;
  return x?.status === 409 && typeof x.extra?.id === 'string' ? x.extra.id : null;
}

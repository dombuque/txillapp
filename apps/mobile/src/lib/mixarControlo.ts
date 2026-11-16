/**
 * Mixar, controlo e resumo (0172): a lógica pura, sem React (os testes em tests/mixarControlo.test.mjs importam este
 * ficheiro diretamente). O contrato está em docs/mixar-contrato.md («Controlo e resumo»); os tipos em
 * lib/api.mixarControlo.ts.
 */
import type { MixarTopic } from './api.mixar';
import type { MixarLessResult, MixarShareTo, MixarTopics, MixarWeek } from './api.mixarControlo';

/* ---------- Afinar os temas ---------- */

/** O texto da ação de tirar um tema. */
export const offActionText = (label: string) => `Não quero «${label}» no nosso Mixar`;

/** O aviso depois de «Menos disto». */
export function lessToast(r: Pick<MixarLessResult, 'topic' | 'author'>): string {
  const who = `@${r.author.username}`;
  return r.topic ? `Vais ver menos de ${r.topic.label} e de ${who} neste Mixar` : `Vais ver menos de ${who} neste Mixar`;
}

export type TopicRowAction = 'restore' | 'normal' | 'off' | 'none';
export interface TopicRow extends MixarTopic {
  /** A linha por baixo do nome. */
  line: string;
  /** O que o botão faz: voltar a pôr (o meu 'off'), voltar ao normal (o meu 'less'), tirar, ou nada (tirado pelo outro). */
  action: TopicRowAction;
  /** O texto do botão (vazio sem ação). */
  button: string;
}
export interface TopicSections { off: TopicRow[]; less: TopicRow[]; rest: TopicRow[] }

/**
 * A folha «Temas do Mixar»: os tirados (os meus voltam a pôr-se; os do outro só se mostram), os que têm «menos» e os
 * outros (primeiro os deste Mixar: em comum, só meus, só do outro; depois o catálogo). Nada se repete.
 */
export function topicSections(t: MixarTopics | null | undefined, mixar: { common?: MixarTopic[]; onlyMe?: MixarTopic[]; onlyThem?: MixarTopic[] } | null | undefined, partner: string): TopicSections {
  const out: TopicSections = { off: [], less: [], rest: [] };
  if (!t) return out;
  const used = new Set<string>();
  for (const m of t.mine.filter((x) => x.mode === 'off')) {
    used.add(m.topic);
    out.off.push({ topic: m.topic, label: m.label, line: 'Tiraste do vosso Mixar', action: 'restore', button: 'Voltar a pôr' });
  }
  for (const m of t.theirsOff) {
    if (used.has(m.topic)) continue;
    used.add(m.topic);
    out.off.push({ topic: m.topic, label: m.label, line: `${partner} tirou do vosso Mixar`, action: 'none', button: '' });
  }
  for (const m of t.mine.filter((x) => x.mode === 'less')) {
    if (used.has(m.topic)) continue;
    used.add(m.topic);
    out.less.push({ topic: m.topic, label: m.label, line: 'Aparece menos neste Mixar', action: 'normal', button: 'Voltar ao normal' });
  }
  const lines: [MixarTopic[] | undefined, string][] = [[mixar?.common, 'Em comum'], [mixar?.onlyMe, 'Do teu gosto'], [mixar?.onlyThem, `Do gosto de ${partner}`], [t.all, '']];
  for (const [list, line] of lines) {
    for (const m of list ?? []) {
      if (used.has(m.topic)) continue;
      used.add(m.topic);
      out.rest.push({ topic: m.topic, label: m.label, line, action: 'off', button: 'Tirar' });
    }
  }
  return out;
}

/* ---------- Temas privados ---------- */

/** Liga ou desliga um tema na lista dos privados (sem repetir, pela ordem em que estavam). */
export function togglePrivate(list: readonly string[], topic: string, on: boolean): string[] {
  const rest = list.filter((t) => t !== topic);
  return on ? [...rest, topic] : rest;
}

/** «Nenhum» / «1 tema» / «3 temas» (na linha das definições). */
export const privateCountLabel = (n: number) => (n <= 0 ? 'Nenhum' : n === 1 ? '1 tema' : `${n} temas`);

/* ---------- Resumo da semana ---------- */

/** 'YYYY-MM-DD' é segunda-feira? (o dia do Mixar, que começa às 05:00 de Maputo) */
export function isMonday(day: string | null | undefined): boolean {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return new Date(`${day}T12:00:00Z`).getUTCDay() === 1;
}

/**
 * As páginas do feed com o cartão da semana: à segunda-feira, logo antes do fim da seleção («Volta amanhã»). Sem a página
 * do fim (ainda há mais para carregar), não entra.
 */
export function withWeekPage<P extends { kind: string; key: string }>(pages: readonly P[], show: boolean): (P | { kind: 'week'; key: 'week' })[] {
  const i = pages.findIndex((p) => p.kind === 'end');
  if (!show || i < 0) return [...pages];
  return [...pages.slice(0, i), { kind: 'week', key: 'week' }, ...pages.slice(i)];
}

/** Os números do cartão (os mesmos textos da imagem desenhada no servidor, mixar-week-card.ts). */
export function weekStats(w: Pick<MixarWeek, 'streak' | 'challenge' | 'videos'>): { key: 'streak' | 'challenge' | 'videos'; value: string; label: string }[] {
  return [
    { key: 'streak', value: String(w.streak), label: w.streak === 1 ? 'dia de série' : 'dias de série' },
    w.challenge.played > 0
      ? { key: 'challenge', value: `${w.challenge.matches} de ${w.challenge.played}`, label: 'acertos no Mixa Challenge' }
      : { key: 'challenge', value: '0', label: 'desafios jogados' },
    { key: 'videos', value: String(w.videos), label: w.videos === 1 ? 'vídeo visto esta semana' : 'vídeos vistos esta semana' },
  ];
}

/** A frase de baixo do cartão. */
export function weekLine(w: Pick<MixarWeek, 'together' | 'challenge'>, partner: string): string {
  if (w.challenge.played > 0 && w.challenge.matches === w.challenge.played) return `Tu e ${partner} escolheram sempre o mesmo. Que sintonia!`;
  if (w.together > 0) return w.together === 1 ? `Viram 1 vídeo os dois.` : `Viram ${w.together} vídeos os dois.`;
  return 'Reajam e joguem o Mixa Challenge para a semana ficar cheia.';
}

/** Depois de partilhar. */
export const shareDoneText = (to: MixarShareTo) => (to === 'zas' ? 'Está no teu Zás' : 'Está nos teus mimos');

/** O texto de um erro ao partilhar. */
export function shareErrorText(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 403) return 'Confirma o teu email para partilhar.';
  if (status === 429) return 'Partilhaste muitas vezes seguidas. Espera um bocadinho.';
  if (status === 404) return 'Este Mixar já não existe.';
  return 'Não consegui partilhar agora. Tenta outra vez.';
}

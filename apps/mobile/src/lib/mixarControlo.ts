/**
 * Mixar, controlo e resumo (0172): a lógica pura, sem React (os testes em tests/mixarControlo.test.mjs importam este
 * ficheiro diretamente). O contrato está em docs/mixar-contrato.md («Controlo e resumo»); os tipos em
 * lib/api.mixarControlo.ts.
 */
import type { MixarTopic } from './api.mixar';
import type { MixarLessResult, MixarShareTo, MixarTopics, MixarWeek } from './api.mixarControlo';
import { t } from '@/lib/i18n';

/* ---------- Afinar os temas ---------- */

/** O texto da ação de tirar um tema. */
export const offActionText = (label: string) => t('Não quero «{label}» no nosso Mixar', { label });

/** O aviso depois de «Menos disto». */
export function lessToast(r: Pick<MixarLessResult, 'topic' | 'author'>): string {
  const who = `@${r.author.username}`;
  return r.topic ? t('Vais ver menos de {label} e de {who} neste Mixar', { label: r.topic.label, who }) : t('Vais ver menos de {who} neste Mixar', { who });
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
export function topicSections(tv: MixarTopics | null | undefined, mixar: { common?: MixarTopic[]; onlyMe?: MixarTopic[]; onlyThem?: MixarTopic[] } | null | undefined, partner: string): TopicSections {
  const out: TopicSections = { off: [], less: [], rest: [] };
  if (!tv) return out;
  const used = new Set<string>();
  for (const m of tv.mine.filter((x) => x.mode === 'off')) {
    used.add(m.topic);
    out.off.push({ topic: m.topic, label: m.label, line: t('Tiraste do vosso Mixar'), action: 'restore', button: t('Voltar a pôr') });
  }
  for (const m of tv.theirsOff) {
    if (used.has(m.topic)) continue;
    used.add(m.topic);
    out.off.push({ topic: m.topic, label: m.label, line: t('{partner} tirou do vosso Mixar', { partner }), action: 'none', button: '' });
  }
  for (const m of tv.mine.filter((x) => x.mode === 'less')) {
    if (used.has(m.topic)) continue;
    used.add(m.topic);
    out.less.push({ topic: m.topic, label: m.label, line: t('Aparece menos neste Mixar'), action: 'normal', button: t('Voltar ao normal') });
  }
  const lines: [MixarTopic[] | undefined, string][] = [[mixar?.common, t('Em comum')], [mixar?.onlyMe, t('Do teu gosto')], [mixar?.onlyThem, t('Do gosto de {partner}', { partner })], [tv.all, '']];
  for (const [list, line] of lines) {
    for (const m of list ?? []) {
      if (used.has(m.topic)) continue;
      used.add(m.topic);
      out.rest.push({ topic: m.topic, label: m.label, line, action: 'off', button: t('Tirar') });
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
export const privateCountLabel = (n: number) => (n <= 0 ? t('Nenhum') : t('{count} tema', { count: n, other: '{count} temas' }));

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
    { key: 'streak', value: String(w.streak), label: w.streak === 1 ? t('dia de série') : t('dias de série') },
    w.challenge.played > 0
      ? { key: 'challenge', value: `${w.challenge.matches} de ${w.challenge.played}`, label: t('acertos no Mixa Challenge') }
      : { key: 'challenge', value: '0', label: t('desafios jogados') },
    { key: 'videos', value: String(w.videos), label: w.videos === 1 ? t('vídeo visto esta semana') : t('vídeos vistos esta semana') },
  ];
}

/** A frase de baixo do cartão. */
export function weekLine(w: Pick<MixarWeek, 'together' | 'challenge'>, partner: string): string {
  if (w.challenge.played > 0 && w.challenge.matches === w.challenge.played) return t('Tu e {partner} escolheram sempre o mesmo. Que sintonia!', { partner });
  if (w.together > 0) return t('Viram {count} vídeo os dois.', { count: w.together, other: 'Viram {count} vídeos os dois.' });
  return t('Reajam e joguem o Mixa Challenge para a semana ficar cheia.');
}

/** Depois de partilhar. */
export const shareDoneText = (to: MixarShareTo) => (to === 'zas' ? t('Está no teu Zás') : t('Está nos teus mimos'));

/** O outro desligou «Deixar que o resumo da semana me inclua» (0179): o resumo vê-se no Mixar mas não se partilha. */
export const weekNotShareableText = (partner: string) => t('{partner} não deixa partilhar o resumo da semana do vosso Mixar. Continuam a vê-lo aqui.', { partner });

/** O texto de um erro ao partilhar. */
export function shareErrorText(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if ((e as { code?: string } | null)?.code === 'mixar_week_not_shareable') return t('A outra pessoa não deixa partilhar o resumo da semana do vosso Mixar.');
  if (status === 403) return t('Confirma o teu email para partilhar.');
  if (status === 429) return t('Partilhaste muitas vezes seguidas. Espera um bocadinho.');
  if (status === 404) return t('Este Mixar já não existe.');
  return t('Não consegui partilhar agora. Tenta outra vez.');
}

import { post, raw, type Post } from '@/lib/api';
import type { MixarPerson, MixarReactionId, MixarTopic } from '@/lib/api.mixar';
import { t } from '@/lib/i18n';

/**
 * Mixar, controlo e resumo (0172, docs/mixar-contrato.md, «Controlo e resumo»): afinar os temas de um Mixar, os temas
 * privados (por pessoa, valem para todos os Mixar) e o resumo da semana com a partilha no Zás e nos mimos. A lógica pura
 * está em lib/mixarControlo.ts.
 */

export type MixarTopicMode = 'less' | 'off';

export interface MixarTopics {
  /** As minhas escolhas neste Mixar. */
  mine: (MixarTopic & { mode: MixarTopicMode })[];
  /** O que o outro tirou (sai para os dois; só quem tirou o volta a pôr). */
  theirsOff: MixarTopic[];
  /** De quantos autores pedi «menos» aqui. */
  lessAuthors: number;
  /** Todos os temas, por nome. */
  all: MixarTopic[];
}

export interface MixarLessResult { topic: MixarTopic | null; author: MixarPerson; topics: MixarTopics }

export interface MixarPrivateTopics { topics: MixarTopic[]; all: MixarTopic[] }

export interface MixarWeek {
  from: string;
  to: string;
  /** «10 a 16 nov». */
  label: string;
  /** Hoje é segunda-feira: o cartão aparece no fim do feed. */
  recapDay: boolean;
  /** O mais reagido pelos dois (sem «nah»). */
  top: { post: Post; mine: MixarReactionId | null; theirs: MixarReactionId | null } | null;
  challenge: { offered: number; played: number; matches: number };
  streak: number;
  /** Até 5, sem os privados de nenhum dos dois. */
  topics: MixarTopic[];
  /** Vídeos da semana vistos por pelo menos um; e pelos dois. */
  videos: number;
  together: number;
}

export type MixarShareTo = 'zas' | 'story';

const put = (b: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(b) });

export const mixarControloApi = {
  topics: (id: string): Promise<MixarTopics> => raw(`/mixar/${id}/topics`),
  /** `mode: null` volta ao normal. */
  setTopic: (id: string, topic: string, mode: MixarTopicMode | null): Promise<MixarTopics> => raw(`/mixar/${id}/topics`, put({ topic, mode })),
  /** «Menos disto» num item: o tema e o autor pesam menos neste Mixar. */
  less: (id: string, postId: string): Promise<MixarLessResult> => raw(`/mixar/${id}/items/${postId}/less`, post({})),
  privateTopics: (): Promise<MixarPrivateTopics> => raw('/me/mixar/private-topics'),
  setPrivateTopics: (topics: string[]): Promise<MixarPrivateTopics> => raw('/me/mixar/private-topics', put({ topics })),
  week: (id: string): Promise<MixarWeek> => raw(`/mixar/${id}/week`),
  /** Partilha o cartão da semana (desenhado no servidor, sem temas privados). */
  shareWeek: (id: string, to: MixarShareTo): Promise<{ to: MixarShareTo; id: string }> => raw(`/mixar/${id}/week/share`, post({ to })),
};

/** Chaves do react-query (as do Mixar começam por ['mixar', id]: invalidar esse prefixo põe tudo em dia). */
export const mixarControloKeys = {
  topics: (id: string) => ['mixar', id, 'topics'] as const,
  week: (id: string) => ['mixar', id, 'week'] as const,
  privateTopics: () => ['mixar-private-topics'] as const,
};

/* ---------- Pré-visualização (só com __DEV__: /mixar/exemplo) ---------- */

const CATALOG: MixarTopic[] = [
  { topic: 'comida', get label() { return t('Comida'); } }, { topic: 'comedia', get label() { return t('Comédia'); } }, { topic: 'danca', get label() { return t('Dança'); } },
  { topic: 'fe', get label() { return t('Fé'); } }, { topic: 'futebol', get label() { return t('Futebol'); } }, { topic: 'humor', get label() { return t('Humor'); } },
  { topic: 'moda', get label() { return t('Moda'); } }, { topic: 'musica', get label() { return t('Música'); } },
];
const prev = { mine: [{ topic: 'futebol', get label() { return t('Futebol'); }, mode: 'less' }] as MixarTopics['mine'], theirsOff: [{ topic: 'fe', get label() { return t('Fé'); } }], priv: [] as MixarTopic[] };
const wait = <T>(v: T, ms = 200) => new Promise<T>((r) => setTimeout(() => r(JSON.parse(JSON.stringify(v)) as T), ms));
const prevTopics = (): MixarTopics => ({ mine: prev.mine, theirsOff: prev.theirsOff, lessAuthors: 1, all: CATALOG });

/** A mesma forma, em memória (para /mixar/exemplo em desenvolvimento). */
export const previewControloApi: typeof mixarControloApi = {
  topics: () => wait(prevTopics()),
  setTopic: async (_id, topic, mode) => {
    prev.mine = prev.mine.filter((t) => t.topic !== topic);
    if (mode) prev.mine.unshift({ topic, label: CATALOG.find((c) => c.topic === topic)?.label ?? topic, mode });
    return wait(prevTopics());
  },
  less: async (_id, _postId) => wait({ topic: { topic: 'musica', label: t('Música') }, author: { username: 'dj_maputo', displayName: 'DJ Maputo', hasAvatar: false, verified: false, verifiedTier: null }, topics: prevTopics() }),
  privateTopics: () => wait({ topics: prev.priv, all: CATALOG }),
  setPrivateTopics: async (topics) => {
    prev.priv = CATALOG.filter((c) => topics.includes(c.topic));
    return wait({ topics: prev.priv, all: CATALOG });
  },
  week: () => wait({ from: '2026-11-10', to: '2026-11-16', label: t('10 a 16 nov'), recapDay: true, top: null, challenge: { offered: 6, played: 5, matches: 3 }, streak: 4, topics: [{ topic: 'musica', label: t('Música') }, { topic: 'comedia', label: t('Comédia') }, { topic: 'comida', label: t('Comida') }], videos: 23, together: 14 }),
  shareWeek: async (_id, to) => wait({ to, id: 'exemplo' }, 600),
};

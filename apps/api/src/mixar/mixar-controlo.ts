import type { Pool } from 'pg';
import type { Candidate, Weights } from './mixar-pick';

/**
 * Controlo dos temas e privacidade dos gostos no Mixar (0172, docs/mixar-contrato.md, «Controlo e resumo»): as peças
 * pequenas que a geração (mixar.service.ts: profile, get, generate e feed) chama, sem mexer no algoritmo de mixar-pick.ts.
 *
 *  - Temas privados (por pessoa, para todos os Mixar): saem do perfil dessa pessoa antes de tudo (compatibilidade, temas em
 *    comum, só teu/só dele, razões dos itens). Na leitura do feed, uma razão já guardada com um tema privado de um dos dois
 *    fica sem tema (a privacidade vale logo, sem esperar pela seleção seguinte).
 *  - 'off' («Não quero isto no nosso Mixar», de qualquer um dos dois): as publicações com esse tema saem da seleção e da
 *    leitura do feed; o tema sai também dos temas do cabeçalho deste Mixar.
 *  - 'less' («Menos disto» num item): o tema e o autor pesam menos na pontuação deste Mixar (multiplicador `boost`).
 */

/** Quanto vale uma publicação com um tema que um dos dois pediu «menos» (multiplica a pontuação). */
export const LESS_TOPIC = 0.35;
/** Quanto vale uma publicação de um autor que um dos dois pediu «menos». */
export const LESS_AUTHOR = 0.3;
/** No máximo quantos temas privados por pessoa (há cerca de 45 temas). */
export const MAX_PRIVATE = 60;

export type TopicMode = 'less' | 'off';

export interface MixarControl {
  /** Temas fora deste Mixar (de qualquer um dos dois). */
  off: Set<string>;
  /** Temas com «menos» (de qualquer um dos dois). */
  less: Set<string>;
  /** Autores com «menos» (de qualquer um dos dois). */
  lessAuthors: Set<string>;
  /** Os temas privados de user_a e de user_b. */
  privA: Set<string>;
  privB: Set<string>;
}

export const emptyControl = (): MixarControl => ({ off: new Set(), less: new Set(), lessAuthors: new Set(), privA: new Set(), privB: new Set() });

/** Os pesos sem estes temas. */
export function dropTopics(w: Weights, ...sets: Iterable<string>[]): Weights {
  const out: Weights = { ...w };
  for (const s of sets) for (const t of s) delete out[t];
  return out;
}

/**
 * Os candidatos com o controlo deste Mixar: sem os que têm um tema 'off'; os que têm um tema 'less' ou são de um autor
 * 'less' ficam com a pontuação multiplicada (`boost`, que se acumula).
 */
export function controlCandidates(cands: readonly Candidate[], ctl: Pick<MixarControl, 'off' | 'less' | 'lessAuthors'>): Candidate[] {
  const out: Candidate[] = [];
  for (const c of cands) {
    if (c.topics.some((t) => ctl.off.has(t))) continue;
    let boost = c.boost ?? 1;
    if (c.topics.some((t) => ctl.less.has(t))) boost *= LESS_TOPIC;
    if (ctl.lessAuthors.has(c.authorId)) boost *= LESS_AUTHOR;
    out.push(boost === (c.boost ?? 1) ? c : { ...c, boost });
  }
  return out;
}

/** A razão de um item já guardado: sem tema se for privado de um dos dois (ou se foi tirado do Mixar). */
export function maskTopic(topic: string | null, hide: ReadonlySet<string>): string | null {
  return topic && hide.has(topic) ? null : topic;
}

/** Os temas privados de uma pessoa. */
export async function privateTopicsOf(pool: Pool, userId: string): Promise<Set<string>> {
  const { rows } = await pool.query('SELECT topic FROM social.mixar_private_topics WHERE user_id = $1', [userId]);
  return new Set(rows.map((r) => r.topic as string));
}

/** Os temas privados de várias pessoas, juntos (para esconder razões e temas da semana dos dois). */
export async function privateTopicsOfAll(pool: Pool, userIds: string[]): Promise<Set<string>> {
  const { rows } = await pool.query('SELECT DISTINCT topic FROM social.mixar_private_topics WHERE user_id = ANY($1::uuid[])', [userIds]);
  return new Set(rows.map((r) => r.topic as string));
}

/** Os temas 'off' deste Mixar (de qualquer um dos dois). */
export async function mixarOffTopics(pool: Pool, mixarId: string): Promise<Set<string>> {
  const { rows } = await pool.query(`SELECT DISTINCT topic FROM social.mixar_topic_prefs WHERE mixar_id = $1 AND mode = 'off'`, [mixarId]);
  return new Set(rows.map((r) => r.topic as string));
}

/** Tudo o que a geração precisa de saber deste Mixar. */
export async function loadControl(pool: Pool, mixarId: string, a: string, b: string): Promise<MixarControl> {
  const [prefs, authors, priv] = await Promise.all([
    pool.query('SELECT topic, mode FROM social.mixar_topic_prefs WHERE mixar_id = $1', [mixarId]),
    pool.query('SELECT DISTINCT author_id FROM social.mixar_author_less WHERE mixar_id = $1', [mixarId]),
    pool.query('SELECT user_id, topic FROM social.mixar_private_topics WHERE user_id = ANY($1::uuid[])', [[a, b]]),
  ]);
  const ctl = emptyControl();
  for (const r of prefs.rows) (r.mode === 'off' ? ctl.off : ctl.less).add(r.topic as string);
  // Um tema 'off' de um e 'less' do outro: fica só 'off'.
  for (const t of ctl.off) ctl.less.delete(t);
  for (const r of authors.rows) ctl.lessAuthors.add(r.author_id as string);
  for (const r of priv.rows) (r.user_id === a ? ctl.privA : ctl.privB).add(r.topic as string);
  return ctl;
}

/**
 * SQL: a publicação `p` não tem nenhum tema 'off' do Mixar `mixarExpr` (para a leitura do feed: o que se tirou sai logo,
 * sem esperar pela seleção seguinte).
 */
export const notOffSql = (mixarExpr: string, postAlias = 'p') =>
  `NOT EXISTS (SELECT 1 FROM social.mixar_topic_prefs mtp WHERE mtp.mixar_id = ${mixarExpr} AND mtp.mode = 'off' AND mtp.topic = ANY(COALESCE(${postAlias}.topics, '{}')))`;

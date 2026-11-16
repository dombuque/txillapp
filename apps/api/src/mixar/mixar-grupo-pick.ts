/**
 * O algoritmo do Mixar de grupo (0173, docs/mixar-contrato.md «Mixar de grupo»), sem base de dados: o mesmo do Mixar a dois
 * (mixar-pick.ts) generalizado de 2 para N pessoas (3 a 5).
 *
 *  - Cada candidato tem uma afinidade com cada participante (a soma dos pesos normalizados dos seus temas). Os «fãs» são
 *    quem tem afinidade positiva e pelo menos 40% da mais forte. Com todos fãs é «de todos» (`all`); senão é de alguns
 *    (`some`, com a lista `fans`). Um tema que alguém marcou «menos» (peso muito negativo) tira a publicação: num grupo, o
 *    que um não quer não aparece a ninguém.
 *  - Pontuação: a média geométrica das afinidades dos fãs, a pesar mais quanto mais fãs há, o perfil do Mixar (o que o
 *    grupo fez lá dentro), a qualidade e os vídeos, com o mesmo ruído estável da semente do dia.
 *  - Variedade: cerca de 60% partilhado (dois fãs ou mais) e o resto dividido por igual entre o gosto de cada um; no máximo
 *    2 por autor. Nunca o que já saiu em dias anteriores.
 */
import { affinity, BOTH_SHARE, commonTopics, hash, MAX_ITEMS, matchScore, normalize, normalizeAbs, onlyOf, type Candidate, type Weights } from './mixar-pick';

export type GroupFrom = 'all' | 'some';

export interface GroupPerson {
  id: string;
  w: Weights;
}

export interface GroupPickInput {
  people: GroupPerson[];
  mixar?: Weights;
  candidates: Candidate[];
  exclude?: Iterable<string>;
  max?: number;
  seed?: string;
  perAuthor?: number;
}

export interface GroupPicked {
  postId: string;
  from: GroupFrom;
  /** Os ids de quem gosta (vazio num item só para encher, sem gosto de ninguém). */
  fans: string[];
  topic: string | null;
  score: number;
}

interface Scored extends GroupPicked {
  authorId: string;
}

/** Os mínimos e máximos do Mixar de grupo. */
export const GROUP_MIN = 3;
export const GROUP_MAX = 5;
const FAN_RATIO = 0.4;
const DISLIKE = -0.05;
const TOPIC_DISLIKE = -0.15;

export function scoreGroupCandidates(input: GroupPickInput): Scored[] {
  const people = input.people.map((p) => ({ id: p.id, w: normalize(p.w) }));
  const n = Math.max(1, people.length);
  const nm = normalizeAbs(input.mixar ?? {});
  const exclude = new Set(input.exclude ?? []);
  const seed = input.seed ?? '';
  const out: Scored[] = [];
  const seen = new Set<string>();
  for (const c of input.candidates) {
    if (exclude.has(c.id) || seen.has(c.id)) continue;
    seen.add(c.id);
    const topics = [...new Set(c.topics)];
    const aff = people.map((p) => affinity(p.w, topics));
    if (aff.some((a) => a.sum < DISLIKE) || topics.some((t) => people.some((p) => (p.w[t] ?? 0) < TOPIC_DISLIKE))) continue;
    const sums = aff.map((a) => Math.max(0, a.sum));
    const best = Math.max(0, ...sums);
    const fanIdx = best > 0 ? sums.map((s, i) => (s > 0 && s >= FAN_RATIO * best ? i : -1)).filter((i) => i >= 0) : [];
    let topic: string | null = null;
    let base = 0;
    if (fanIdx.length) {
      // O tema que mais pesa nos fãs (a média geométrica de cada tema entre eles).
      let bw = 0;
      for (const t of topics) {
        const v = Math.pow(fanIdx.reduce((m, i) => m * Math.max(0, people[i].w[t] ?? 0), 1), 1 / fanIdx.length);
        if (v > bw) {
          bw = v;
          topic = t;
        }
      }
      topic = topic ?? aff[fanIdx[0]].best;
      const geo = Math.pow(fanIdx.reduce((m, i) => m * sums[i], 1), 1 / fanIdx.length);
      base = 2 * geo * (fanIdx.length / n) + 0.5 * best;
    }
    const M = affinity(nm, topics).sum;
    const q = Math.max(0, Math.min(1, c.quality));
    const noise = (hash(`${seed}:${c.id}`) % 1000) / 1000;
    const score = (base + 0.6 * M + 0.02) * (0.6 + 0.4 * q) * (c.video ? 1.25 : 1) * (1 + 0.08 * noise) * Math.max(0, c.boost ?? 1);
    const fans = fanIdx.map((i) => people[i].id);
    out.push({ postId: c.id, from: fans.length === n || !fans.length ? 'all' : 'some', fans, topic, score: Math.round(score * 1e6) / 1e6, authorId: c.authorId });
  }
  return out.sort((x, y) => y.score - x.score || x.postId.localeCompare(y.postId));
}

/** A seleção do dia de um Mixar de grupo (até 24). */
export function pickGroupDaily(input: GroupPickInput): GroupPicked[] {
  const max = Math.max(0, Math.min(MAX_ITEMS, input.max ?? MAX_ITEMS));
  const perAuthor = input.perAuthor ?? 2;
  const ids = input.people.map((p) => p.id);
  const scored = scoreGroupCandidates(input);
  const withTaste = scored.filter((s) => s.fans.length > 0);
  const fillers = scored.filter((s) => !s.fans.length);
  const nShared = Math.round(max * BOTH_SHARE);
  const nEach = ids.length ? Math.max(1, Math.floor((max - nShared) / ids.length)) : 0;
  const byAuthor = new Map<string, number>();
  const taken = new Set<string>();
  const can = (s: Scored) => !taken.has(s.postId) && (byAuthor.get(s.authorId) ?? 0) < perAuthor;
  const take = (s: Scored) => {
    taken.add(s.postId);
    byAuthor.set(s.authorId, (byAuthor.get(s.authorId) ?? 0) + 1);
  };
  const shared: Scored[] = [];
  const single = new Map<string, Scored[]>(ids.map((id) => [id, []]));
  for (const s of withTaste) {
    if (shared.length >= nShared) break;
    if (s.fans.length >= 2 && can(s)) {
      take(s);
      shared.push(s);
    }
  }
  for (const id of ids) {
    const q = single.get(id)!;
    for (const s of withTaste) {
      if (q.length >= nEach || shared.length + [...single.values()].reduce((n, x) => n + x.length, 0) >= max) break;
      if (s.fans.length === 1 && s.fans[0] === id && can(s)) {
        take(s);
        q.push(s);
      }
    }
  }
  // O que sobra: primeiro o que tem gosto, depois o que só tem qualidade.
  let left = max - shared.length - [...single.values()].reduce((n, x) => n + x.length, 0);
  for (const s of [...withTaste, ...fillers]) {
    if (left <= 0) break;
    if (!can(s)) continue;
    take(s);
    if (s.fans.length === 1 && single.has(s.fans[0])) single.get(s.fans[0])!.push(s);
    else shared.push(s);
    left--;
  }
  const bySc = (x: Scored, y: Scored) => y.score - x.score || x.postId.localeCompare(y.postId);
  shared.sort(bySc);
  for (const q of single.values()) q.sort(bySc);
  // Intercala: partilhado, um de alguém (rodando pelas pessoas), partilhado, …
  const out: GroupPicked[] = [];
  const total = shared.length + [...single.values()].reduce((n, x) => n + x.length, 0);
  let turn = 0;
  for (let i = 0; out.length < total; i++) {
    let s: Scored | undefined;
    if (i % 2 === 0) s = shared.shift();
    if (!s) {
      for (let k = 0; k < ids.length && !s; k++) {
        s = single.get(ids[(turn + k) % ids.length])!.shift();
        if (s) turn = (turn + k + 1) % ids.length;
      }
    }
    s = s ?? shared.shift();
    if (!s) break;
    out.push({ postId: s.postId, from: s.from, fans: s.fans, topic: s.topic, score: s.score });
  }
  return out;
}

/** O `match` do grupo (0 a 100): a média dos matches de cada par. */
export function groupMatch(profiles: Weights[]): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      sum += matchScore(profiles[i], profiles[j]);
      n++;
    }
  }
  return n ? Math.round(sum / n) : 0;
}

/** Os temas de que todos gostam (média geométrica, 0 a 100 relativo ao mais forte), do mais forte para o mais fraco. */
export function groupCommon(profiles: Weights[], n = 8): { topic: string; score: number }[] {
  if (profiles.length === 2) return commonTopics(profiles[0], profiles[1], n);
  const norm = profiles.map(normalize);
  if (!norm.length) return [];
  const list = Object.keys(norm[0])
    .filter((t) => norm.every((w) => (w[t] ?? 0) > 0))
    .map((t) => ({ topic: t, s: Math.pow(norm.reduce((m, w) => m * w[t], 1), 1 / norm.length) }))
    .sort((x, y) => y.s - x.s || x.topic.localeCompare(y.topic))
    .slice(0, n);
  const top = list[0]?.s ?? 0;
  return list.map((x) => ({ topic: x.topic, score: top ? Math.max(1, Math.round((100 * x.s) / top)) : 0 }));
}

/** O que é mais meu do que do resto do grupo. */
export function groupOnlyMe(mine: Weights, others: Weights[], n = 4): string[] {
  const rest: Weights = {};
  for (const w of others.map(normalize)) for (const [k, v] of Object.entries(w)) rest[k] = (rest[k] ?? 0) + v / Math.max(1, others.length);
  return onlyOf(mine, rest, n);
}

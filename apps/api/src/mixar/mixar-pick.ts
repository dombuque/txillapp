/**
 * O algoritmo do Mixar (docs/mixar-contrato.md), sem base de dados: recebe os perfis de temas dos dois, o perfil do próprio
 * Mixar e os candidatos (publicações que os dois podem ver) e devolve a seleção do dia, o desafio e as contas do cabeçalho.
 *
 *  - Perfis: os pesos por tema de cada pessoa (o mesmo perfil do Explorar: brindes, comentários, guardados, seguidos,
 *    «interessado/não interessado» e as preferências por tema; ver posts/interest.ts) e o perfil do Mixar (o que os dois
 *    fizeram lá dentro: reações, vistos até ao fim, envios para o chat e escolhas nos desafios). Normalizam-se para cada
 *    pessoa contar o mesmo, por muito ou pouco que use a app.
 *  - Cada candidato tem uma afinidade com cada um (a soma dos pesos dos seus temas). Se bate com os dois de forma parecida é
 *    «dos dois» (`both`); senão é de quem tem mais afinidade (`a` ou `b`). Um tema que um dos dois marcou «menos» (peso
 *    negativo) tira a publicação.
 *  - Pontuação: os temas em comum pesam mais (média geométrica das duas afinidades), o perfil do Mixar soma, e a qualidade
 *    (reações por alcance e frescura, já calculada) e os vídeos sobem um pouco. Um pequeno ruído estável (pela semente do
 *    dia, até 8%) muda a ordem de dia para dia.
 *  - Variedade: cerca de 60% «dos dois» e o resto dividido entre o que é só de um e só do outro; no máximo 2 por autor.
 *    Sem perfis (contas novas) fica o que tem mais qualidade. Nunca o que já saiu em dias anteriores.
 */

export type Weights = Record<string, number>;
export type From = 'a' | 'b' | 'both';

export interface Candidate {
  id: string;
  authorId: string;
  topics: string[];
  /** Qualidade 0–1 (reações por alcance, frescura, já visto): calculada por quem chama. */
  quality: number;
  video: boolean;
}

export interface Picked {
  postId: string;
  from: From;
  topic: string | null;
  score: number;
}

export interface PickInput {
  a: Weights;
  b: Weights;
  /** O perfil do próprio Mixar (pode ter pesos negativos: «nah», saltar logo). */
  mixar?: Weights;
  candidates: Candidate[];
  /** Publicações que já saíram em dias anteriores. */
  exclude?: Iterable<string>;
  /** Quantos itens (até 24). */
  max?: number;
  /** Semente do ruído (por exemplo o id do Mixar e o dia). */
  seed?: string;
  /** No máximo quantas publicações do mesmo autor. */
  perAuthor?: number;
}

export const MAX_ITEMS = 24;
/** A parte «dos dois» da seleção; o resto divide-se entre o que é só de um e só do outro. */
export const BOTH_SHARE = 0.6;
/** «Dos dois» quando a afinidade mais fraca chega a esta fração da mais forte. */
const BOTH_RATIO = 0.4;
/** Abaixo disto (normalizado) conta como «não quero»: a publicação não entra. */
const DISLIKE = -0.05;
/** Um tema com este peso negativo (normalizado) num dos dois tira a publicação, mesmo que os outros temas dela agradem. */
const TOPIC_DISLIKE = -0.15;

/** FNV-1a de 32 bits: um número estável para uma cadeia (o ruído e as escolhas do desafio). */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Os pesos divididos pela soma dos positivos (os negativos ficam, na mesma escala). Sem positivos: só os negativos, sobre 1. */
export function normalize(w: Weights): Weights {
  const pos = Object.values(w).reduce((s, v) => s + (v > 0 ? v : 0), 0);
  const den = pos > 0 ? pos : 1;
  const out: Weights = {};
  for (const [k, v] of Object.entries(w)) if (Number.isFinite(v) && v !== 0) out[k] = v / den;
  return out;
}

/** O mesmo, mas pela soma dos valores absolutos (o perfil do Mixar, em que o «nah» conta tanto como as outras reações). */
function normalizeAbs(w: Weights): Weights {
  const tot = Object.values(w).reduce((s, v) => s + Math.abs(v), 0);
  const out: Weights = {};
  if (!tot) return out;
  for (const [k, v] of Object.entries(w)) if (Number.isFinite(v) && v !== 0) out[k] = v / tot;
  return out;
}

const positive = (w: Weights) => Object.fromEntries(Object.entries(w).filter(([, v]) => v > 0));

/** Semelhança de cosseno entre os dois perfis (só os gostos: os pesos positivos). 0 sem nada em comum ou sem perfil. */
export function cosine(a: Weights, b: Weights): number {
  const pa = positive(a);
  const pb = positive(b);
  let dot = 0;
  for (const [k, v] of Object.entries(pa)) dot += v * (pb[k] ?? 0);
  const na = Math.sqrt(Object.values(pa).reduce((s, v) => s + v * v, 0));
  const nb = Math.sqrt(Object.values(pb).reduce((s, v) => s + v * v, 0));
  return na && nb ? dot / (na * nb) : 0;
}

/**
 * O `match` do cabeçalho (0–100): a raiz do cosseno, para espalhar os valores (dois perfis com metade dos gostos em comum
 * já dão perto de 70, que é o que as pessoas esperam ver).
 */
export function matchScore(a: Weights, b: Weights): number {
  return Math.max(0, Math.min(100, Math.round(100 * Math.sqrt(Math.max(0, cosine(a, b))))));
}

/**
 * Temas em comum, do mais forte para o mais fraco: `score` 0–100 relativo ao mais forte (média geométrica dos pesos).
 * Só os equilibrados: se um dos dois tem menos de metade do peso do outro, o tema é «só teu» / «só dele» (onlyOf) e não
 * aparece também aqui (a Descoberta mostrava o mesmo tema em «Em comum» e em «Só de Ana»).
 */
export function commonTopics(a: Weights, b: Weights, n = 8): { topic: string; score: number }[] {
  const na = normalize(a);
  const nb = normalize(b);
  const both = Object.keys(na)
    .filter((t) => na[t] > 0 && (nb[t] ?? 0) > 0 && nb[t] >= na[t] / 2 && na[t] >= nb[t] / 2)
    .map((t) => ({ topic: t, s: Math.sqrt(na[t] * nb[t]) }))
    .sort((x, y) => y.s - x.s || x.topic.localeCompare(y.topic))
    .slice(0, n);
  const top = both[0]?.s ?? 0;
  return both.map((x) => ({ topic: x.topic, score: top ? Math.max(1, Math.round((100 * x.s) / top)) : 0 }));
}

/** O que é mais de `a` do que de `b`: temas de `a` em que `b` tem menos de metade do peso, pelo que sobra. */
export function onlyOf(a: Weights, b: Weights, n = 4): string[] {
  const na = normalize(a);
  const nb = normalize(b);
  return Object.keys(na)
    .filter((t) => na[t] > 0 && (nb[t] ?? 0) < na[t] / 2)
    .map((t) => ({ t, s: na[t] - Math.max(0, nb[t] ?? 0) }))
    .sort((x, y) => y.s - x.s || x.t.localeCompare(y.t))
    .slice(0, n)
    .map((x) => x.t);
}

interface Scored extends Picked {
  authorId: string;
  video: boolean;
}

/** A afinidade e o tema mais forte de uma publicação para um perfil. */
function affinity(w: Weights, topics: string[]) {
  let sum = 0;
  let best: string | null = null;
  let bestW = 0;
  for (const t of topics) {
    const v = w[t] ?? 0;
    sum += v;
    if (v > bestW) {
      bestW = v;
      best = t;
    }
  }
  return { sum, best };
}

/** Classifica e pontua cada candidato (sem os excluídos e sem os que um dos dois não quer). */
export function scoreCandidates(input: PickInput): Scored[] {
  const na = normalize(input.a);
  const nb = normalize(input.b);
  const nm = normalizeAbs(input.mixar ?? {});
  const exclude = new Set(input.exclude ?? []);
  const seed = input.seed ?? '';
  const out: Scored[] = [];
  const seen = new Set<string>();
  for (const c of input.candidates) {
    if (exclude.has(c.id) || seen.has(c.id)) continue;
    seen.add(c.id);
    const topics = [...new Set(c.topics)];
    const A = affinity(na, topics);
    const B = affinity(nb, topics);
    if (Math.min(A.sum, B.sum) < DISLIKE || topics.some((t) => (na[t] ?? 0) < TOPIC_DISLIKE || (nb[t] ?? 0) < TOPIC_DISLIKE)) continue;
    const M = affinity(nm, topics).sum;
    const sa = Math.max(0, A.sum);
    const sb = Math.max(0, B.sum);
    let from: From;
    let topic: string | null;
    let base: number;
    if (sa > 0 && sb > 0 && Math.min(sa, sb) >= BOTH_RATIO * Math.max(sa, sb)) {
      from = 'both';
      // O tema que mais pesa nos dois (a média geométrica de cada tema).
      let best: string | null = null;
      let bw = 0;
      for (const t of topics) {
        const v = Math.sqrt(Math.max(0, na[t] ?? 0) * Math.max(0, nb[t] ?? 0));
        if (v > bw) {
          bw = v;
          best = t;
        }
      }
      topic = best ?? A.best ?? B.best;
      base = 2 * Math.sqrt(sa * sb) + 0.5 * Math.max(sa, sb);
    } else if (sa > 0 || sb > 0) {
      from = sa >= sb ? 'a' : 'b';
      topic = from === 'a' ? A.best : B.best;
      base = Math.max(sa, sb);
    } else {
      // Sem afinidade com nenhum dos dois: só entra para encher (o que tem mais qualidade). Fica «dos dois», sem tema.
      from = 'both';
      topic = null;
      base = 0;
    }
    const q = Math.max(0, Math.min(1, c.quality));
    const noise = (hash(`${seed}:${c.id}`) % 1000) / 1000;
    const score = (base + 0.6 * M + 0.02) * (0.6 + 0.4 * q) * (c.video ? 1.25 : 1) * (1 + 0.08 * noise);
    out.push({ postId: c.id, from, topic, score: Math.round(score * 1e6) / 1e6, authorId: c.authorId, video: c.video });
  }
  return out.sort((x, y) => y.score - x.score || x.postId.localeCompare(y.postId));
}

/** A ordem do feed: dois «dos dois» por cada um de cada lado, alternando (both, a, both, b, both, …). */
const PATTERN: From[] = ['both', 'a', 'both', 'b', 'both'];

/** A seleção do dia. */
export function pickDaily(input: PickInput): Picked[] {
  const max = Math.max(0, Math.min(MAX_ITEMS, input.max ?? MAX_ITEMS));
  const perAuthor = input.perAuthor ?? 2;
  const scored = scoreCandidates(input);
  const withTaste = scored.filter((s) => s.topic !== null || s.from !== 'both');
  const fillers = scored.filter((s) => s.topic === null && s.from === 'both');
  // Quotas: ~60% dos dois, o resto meio a meio (o que faltar num lado passa para os outros).
  const nBoth = Math.round(max * BOTH_SHARE);
  const nSide = Math.floor((max - nBoth) / 2);
  const byAuthor = new Map<string, number>();
  const taken = new Set<string>();
  const can = (s: Scored) => !taken.has(s.postId) && (byAuthor.get(s.authorId) ?? 0) < perAuthor;
  const take = (s: Scored) => {
    taken.add(s.postId);
    byAuthor.set(s.authorId, (byAuthor.get(s.authorId) ?? 0) + 1);
  };
  const queues: Record<From, Scored[]> = { both: [], a: [], b: [] };
  const quota: Record<From, number> = { both: nBoth, a: nSide, b: nSide };
  for (const from of ['both', 'a', 'b'] as From[]) {
    for (const s of withTaste) {
      if (queues[from].length >= quota[from]) break;
      if (s.from === from && can(s)) {
        take(s);
        queues[from].push(s);
      }
    }
  }
  // O que sobra: primeiro o que tem gosto (de qualquer lado), depois o que só tem qualidade.
  const extra: Scored[] = [];
  let left = max - queues.both.length - queues.a.length - queues.b.length;
  for (const s of [...withTaste, ...fillers]) {
    if (left <= 0) break;
    if (can(s)) {
      take(s);
      extra.push(s);
      left--;
    }
  }
  for (const s of extra) queues[s.from].push(s);
  for (const k of Object.keys(queues) as From[]) queues[k].sort((x, y) => y.score - x.score || x.postId.localeCompare(y.postId));
  // Intercala pelo padrão; quando uma fila acaba, segue a próxima que ainda tem.
  const out: Picked[] = [];
  const total = queues.both.length + queues.a.length + queues.b.length;
  for (let i = 0; out.length < total; i++) {
    const want = PATTERN[i % PATTERN.length];
    const order: From[] = [want, ...(['both', 'a', 'b'] as From[]).filter((f) => f !== want)];
    const q = order.map((f) => queues[f]).find((x) => x.length)!;
    const s = q.shift()!;
    out.push({ postId: s.postId, from: s.from, topic: s.topic, score: s.score });
  }
  return out;
}

/** As perguntas do desafio, com o texto do contrato. */
export const CHALLENGE_KINDS = ['mais_engracado', 'mais_txilado', 'partilhavas', 'repetias'] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];
export const CHALLENGE_QUESTION: Record<ChallengeKind, string> = {
  mais_engracado: 'Qual é o mais engraçado?',
  mais_txilado: 'Qual tem mais vibe?',
  partilhavas: 'Qual mandavas ao grupo?',
  repetias: 'Qual vias outra vez?',
};
const FUNNY = new Set(['humor', 'humor-relacoes', 'humor-familia', 'humor-trabalho', 'humor-escola', 'humor-rua', 'memes', 'partidas', 'comedia']);

/**
 * O desafio do dia, a partir dos itens do dia: 4 opções com 8 ou mais itens, senão 3 (com menos de 3 não há desafio).
 * Escolhe entre os melhores (os vídeos primeiro), com a semente a variar quais. A pergunta roda com a semente; «Qual é o mais
 * engraçado?» só quando pelo menos duas opções são de humor.
 */
export function pickChallenge(items: { postId: string; video: boolean; score: number; topic: string | null }[], seed: string): { kind: ChallengeKind; options: string[] } | null {
  if (items.length < 3) return null;
  const n = items.length >= 8 ? 4 : 3;
  const ranked = [...items].sort((x, y) => Number(y.video) - Number(x.video) || y.score - x.score || x.postId.localeCompare(y.postId));
  const pool = ranked.slice(0, Math.max(n, Math.min(10, ranked.length)));
  const options = pool
    .map((x) => ({ x, k: hash(`${seed}:${x.postId}`) }))
    .sort((p, q) => p.k - q.k)
    .slice(0, n)
    .map((p) => p.x);
  const funny = options.filter((o) => o.topic && FUNNY.has(o.topic)).length >= 2;
  const kinds = funny ? CHALLENGE_KINDS : CHALLENGE_KINDS.filter((k) => k !== 'mais_engracado');
  return { kind: kinds[hash(`${seed}:kind`) % kinds.length], options: options.map((o) => o.postId) };
}

/** O dia anterior a 'YYYY-MM-DD'. */
export function prevDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * A série: quantos dias seguidos os dois jogaram o desafio, a acabar hoje (ou ontem, se hoje ainda não jogaram os dois:
 * a série só se perde quando um dia passa sem jogarem). `played` = os dias em que os dois escolheram.
 */
export function streakOf(played: Iterable<string>, today: string): number {
  const days = new Set(played);
  let d = days.has(today) ? today : prevDay(today);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = prevDay(d);
  }
  return n;
}

/** O dia do Mixar: começa às 05:00 de Maputo (UTC+2, sem hora de verão), a hora da seleção diária. */
export const DAY_STARTS_HOUR = 5;
export function mixarDay(now: Date = new Date()): string {
  return new Date(now.getTime() + (2 - DAY_STARTS_HOUR) * 3_600_000).toISOString().slice(0, 10);
}

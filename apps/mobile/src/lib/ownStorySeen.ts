/**
 * "Já vi os meus mimos": o servidor guarda-o na conta (o `seen` da bandeja e da lista vem certo em todos os aparelhos).
 * Este aparelho guarda também a hora do último que vi (ownSeen.ts), só como reforço imediato enquanto o servidor não
 * responde. As horas comparam-se como datas (Date.parse), nunca como texto: o mesmo instante pode vir escrito de outra forma.
 * Lógica pura, sem React nem armazenamento, para se testar em tests/ownStorySeen.test.mjs.
 */

/** Já vi até `ownSeenAt` (neste aparelho): o story criado em `createdAt` está visto? Datas vazias ou inválidas: não. */
export function seenUpTo(ownSeenAt: string | null | undefined, createdAt: string | null | undefined): boolean {
  if (!ownSeenAt || !createdAt) return false;
  const a = Date.parse(ownSeenAt);
  const b = Date.parse(createdAt);
  return Number.isFinite(a) && Number.isFinite(b) && a >= b;
}

/** Um story está visto se o servidor o diz ou, se for meu, se este aparelho já o viu. */
export function storySeen(story: { seen: boolean; createdAt: string }, mine: boolean, ownSeenAt: string | null | undefined): boolean {
  return !!story.seen || (mine && seenUpTo(ownSeenAt, story.createdAt));
}

/** Por onde começar: o primeiro ainda por ver; se já vi todos, o primeiro. */
export function firstToWatch(stories: { seen: boolean; createdAt: string }[], mine: boolean, ownSeenAt: string | null | undefined): number {
  const n = stories.findIndex((x) => !storySeen(x, mine, ownSeenAt));
  return n === -1 ? 0 : n;
}

/** Quantos segmentos do anel ficam a cinzento (vistos). */
export function seenSegments(stories: { seen: boolean; createdAt: string }[], mine: boolean, ownSeenAt: string | null | undefined): number {
  return stories.filter((x) => storySeen(x, mine, ownSeenAt)).length;
}

/** O meu na bandeja ("O teu mimo"): visto e quantos segmentos a cinzento. Sem mimo meu: nada visto. */
export function trayMine(
  mine: { count: number; seenCount: number; seen: boolean; latestAt: string } | undefined,
  ownSeenAt: string | null | undefined,
): { seen: boolean; seenCount: number } {
  if (!mine) return { seen: false, seenCount: 0 };
  if (mine.seen || seenUpTo(ownSeenAt, mine.latestAt)) return { seen: true, seenCount: mine.count };
  return { seen: false, seenCount: Math.min(mine.seenCount ?? 0, mine.count) };
}

/** O que guardar neste aparelho depois de ver um meu: nunca recua (ver um mais antigo não desfaz os seguintes). */
export function nextOwnSeen(prev: string | null | undefined, createdAt: string): string {
  return seenUpTo(prev, createdAt) ? (prev as string) : createdAt;
}

/** Depois de ver um story, a lista em cache fica a dizê-lo (os meus: também os anteriores a ele). */
export function markSeen<T extends { id: string; seen: boolean; createdAt: string }>(list: T[] | undefined, story: { id: string; createdAt: string }, mine: boolean): T[] | undefined {
  if (!list) return list;
  return list.map((x) => (x.seen || !(x.id === story.id || (mine && seenUpTo(story.createdAt, x.createdAt))) ? x : { ...x, seen: true }));
}

/** Guardado no aparelho como "@ hora", para não passar de uma conta para outra no mesmo aparelho. */
export function packOwnSeen(username: string, at: string): string {
  return `${username.toLowerCase()} ${at}`;
}

/** A hora guardada para esta conta, ou '' (outra conta, nada guardado, ou o formato antigo sem o @). */
export function ownSeenFor(raw: string | null | undefined, username: string | null | undefined): string {
  if (!raw || !username) return '';
  const sp = raw.indexOf(' ');
  if (sp <= 0) return '';
  return raw.slice(0, sp) === username.toLowerCase() ? raw.slice(sp + 1) : '';
}

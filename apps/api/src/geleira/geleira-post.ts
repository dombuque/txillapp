import { BadRequestException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { blockedBetween } from '../social/visibility';

/**
 * A geleira partilhada como publicação (0143). O post leva um retrato (`content.posts.geleira`) dos gostos no momento da
 * partilha: a ordem, os nomes e o desenho (slug, tipo e grupo, de onde a app tira o ícone). Os brindes a cada item, no cartão
 * do post ou no perfil, vivem em taste.geleira_item_cheers: uma linha por pessoa e item, por isso nunca contam duas vezes.
 */

/** Quantos itens entram no retrato (os primeiros pela ordem do perfil: favoritos, nota, os mais recentes). */
export const SNAPSHOT_MAX = 48;

export interface SnapshotItem {
  id: string;
  slug: string;
  name: string;
  kind: 'bebida' | 'comida';
  category: string;
  alcoholic: boolean;
  favorite: boolean;
  rating: number | null;
}
export interface GeleiraSnapshot {
  v: 1;
  /** Nível da geleira quando foi partilhada (0 a 4, a mesma conta do perfil). */
  level: number;
  /** Quantos gostos tinha (todos) e quantos sem álcool (o que vê quem tem menos de 18 anos). */
  total: number;
  totalSoft: number;
  items: SnapshotItem[];
}

/** O que a app recebe em `post.geleira`: o retrato visto por quem pede (sem álcool para menores) e os brindes de cada item. */
export interface GeleiraPostDto {
  level: number;
  total: number;
  items: (Omit<SnapshotItem, 'alcoholic'> & { alcoholic: boolean; cheers: number; cheered: boolean })[];
}

/** O nível da geleira pelos números (a mesma conta de GeleiraService.level): quantidade, variedade e gostos avaliados. */
export function levelOf(s: { n: number; fav: number; rated: number; cats: number }) {
  const points = s.n + s.fav + Math.floor(s.rated / 2) + s.cats;
  const steps = [1, 12, 30, 60];
  const byPoints = points <= 0 ? 0 : points >= steps[3] ? 4 : points >= steps[2] ? 3 : points >= steps[1] ? 2 : 1;
  const gate = s.cats >= 6 && s.rated >= 10 ? 4 : s.cats >= 4 && s.rated >= 5 ? 3 : 2;
  return { points, byPoints, level: Math.min(byPoints, gate), steps };
}

/**
 * O retrato da minha geleira agora: o que o perfil mostra (bebidas e comidas aprovadas), pela mesma ordem. Sem nada para
 * mostrar, não se partilha (400, com a explicação).
 */
export async function buildSnapshot(db: Pool | PoolClient, userId: string): Promise<GeleiraSnapshot> {
  const { rows } = await db.query(
    `SELECT i.id, i.slug, i.name, i.kind, i.category, i.alcoholic, ui.favorite, ui.rating
       FROM taste.user_items ui JOIN taste.items i ON i.id = ui.item_id
      WHERE ui.user_id = $1 AND i.status = 'curated' AND i.kind IN ('bebida', 'comida')
      ORDER BY ui.favorite DESC, ui.rating DESC NULLS LAST, ui.updated_at DESC, i.name`,
    [userId],
  );
  if (!rows.length) throw new BadRequestException('A tua geleira está vazia. Junta bebidas ou comidas antes de a partilhar.');
  const all = rows as SnapshotItem[];
  const { level } = levelOf({
    n: all.length,
    fav: all.filter((i) => i.favorite).length,
    rated: all.filter((i) => i.rating != null).length,
    cats: new Set(all.map((i) => i.category)).size,
  });
  return {
    v: 1,
    level,
    total: all.length,
    totalSoft: all.filter((i) => !i.alcoholic).length,
    items: all.slice(0, SNAPSHOT_MAX).map((i) => ({ id: i.id, slug: i.slug, name: i.name, kind: i.kind, category: i.category, alcoholic: !!i.alcoholic, favorite: !!i.favorite, rating: (i.rating as number | null) ?? null })),
  };
}

/** Lê o retrato guardado (ignora o que não tem o formato certo). */
export function readSnapshot(v: unknown): GeleiraSnapshot | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Partial<GeleiraSnapshot>;
  if (s.v !== 1 || !Array.isArray(s.items)) return null;
  return s as GeleiraSnapshot;
}

/**
 * Brindes por item (de quem tem a conta ativa e não tem bloqueio com o dono, como a contagem da geleira) e se quem pede
 * brindou, para vários donos de uma vez. Chave: `${ownerId}:${itemId}`.
 */
export async function itemCheers(db: Pool | PoolClient, viewerId: string, owners: { ownerId: string; itemIds: string[] }[]) {
  const out = new Map<string, { cheers: number; cheered: boolean }>();
  const pairs = owners.flatMap((o) => o.itemIds.map((i) => [o.ownerId, i] as const));
  if (!pairs.length) return out;
  const { rows } = await db.query(
    `SELECT c.owner_id, c.item_id, count(*)::int AS n, bool_or(c.user_id = $1) AS mine
       FROM taste.geleira_item_cheers c JOIN identity.users u ON u.id = c.user_id
       JOIN (SELECT DISTINCT * FROM unnest($2::uuid[], $3::uuid[]) AS x(owner_id, item_id)) w ON w.owner_id = c.owner_id AND w.item_id = c.item_id
      WHERE u.status = 'active' AND NOT ${blockedBetween('u.id', 'c.owner_id')}
      GROUP BY c.owner_id, c.item_id`,
    [viewerId, pairs.map((p) => p[0]), pairs.map((p) => p[1])],
  );
  for (const r of rows) out.set(`${r.owner_id as string}:${r.item_id as string}`, { cheers: r.n as number, cheered: !!r.mine });
  return out;
}

/** O retrato como quem pede o vê: quem tem menos de 18 anos (ou sem data de nascimento) não vê as bebidas alcoólicas. */
export function geleiraDto(snap: GeleiraSnapshot, ownerId: string, adult: boolean, cheers: Map<string, { cheers: number; cheered: boolean }>): GeleiraPostDto {
  const items = snap.items.filter((i) => adult || !i.alcoholic);
  return {
    level: snap.level,
    total: adult ? snap.total : snap.totalSoft,
    items: items.map((i) => ({ ...i, ...(cheers.get(`${ownerId}:${i.id}`) ?? { cheers: 0, cheered: false }) })),
  };
}

/** Para um cartão público (link partilhado, robôs das redes): sem álcool, como para quem não tem idade confirmada. */
export function publicItems(snap: GeleiraSnapshot) {
  return snap.items.filter((i) => !i.alcoholic);
}

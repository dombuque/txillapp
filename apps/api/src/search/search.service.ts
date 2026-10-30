import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { PostsService } from '../posts/posts.service';
import { SearchIndexer } from './search-index';
import { isValidTag, normalizeTag } from '../common/hashtags';
import { blockedBetween, inMyNetwork } from '../social/visibility';

/** Escapa % _ \ para usar o texto da pesquisa em ILIKE sem que vire padrão. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

/** Contas e publicações que qualquer pessoa pode ver (para tendências): públicas, ativas, sem remoção. */
const PUBLIC_POST = `p.removed_at IS NULL AND p.kind IN ('post', 'repost') AND u.status = 'active' AND NOT u.is_private`;

@Injectable()
export class SearchService {
  private trendingCache = new Map<string, { at: number; value: unknown }>();

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly posts: PostsService,
    private readonly indexer: SearchIndexer,
  ) {}

  /**
   * Pesquisa de pessoas (por @ ou nome) e de publicações (texto ou local). Respeita bloqueios, contas eliminadas
   * e perfis privados: só aparecem publicações que o espectador já podia ver.
   */
  async search(viewerId: string, raw: string) {
    const term = raw.trim().replace(/^@/, '').slice(0, 50);
    if (term.length < 2) return { query: term, people: [], posts: [], tags: [] };
    // "#praia": só hashtags.
    if (raw.trim().startsWith('#')) return { query: term, people: [], posts: [], tags: await this.tagsLike(viewerId, raw.trim().slice(1)) };
    const contains = `%${escapeLike(term)}%`;
    const prefix = `${escapeLike(term)}%`;

    // Com Elasticsearch: ele ordena por relevância (ids); o PostgreSQL decide o que cada pessoa pode ver.
    // Se falhar, cai para a pesquisa do PostgreSQL (abaixo): a pesquisa nunca fica em baixo por causa dele.
    if (this.indexer.enabled) {
      try {
        const [userIds, postIds] = await Promise.all([this.indexer.searchUsers(term, 30), this.indexer.searchPosts(term, 60)]);
        const peopleRows = userIds.length ? await this.peopleByIds(viewerId, userIds) : [];
        return {
          query: term,
          people: peopleRows.slice(0, 15),
          tags: await this.tagsLike(viewerId, term),
          posts: await this.posts.byIds(viewerId, postIds, 12),
        };
      } catch {
        /* segue para o PostgreSQL */
      }
    }

    const people = await this.pool.query(
      `SELECT u.username, u.display_name, u.is_private, u.verified,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS following,
              EXISTS (SELECT 1 FROM social.follow_requests r WHERE r.requester_id = $1 AND r.target_id = u.id) AS requested,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id AND f.followee_id = $1) AS follows_you,
              (SELECT count(*) FROM social.follows f WHERE f.followee_id = u.id)::int AS followers
         FROM identity.users u
        WHERE u.status = 'active' AND u.id <> $1 AND NOT ${blockedBetween('u.id', '$1')} AND ${inMyNetwork('u.id', 'u.country')}
          AND (u.username ILIKE $2 ESCAPE '\\' OR u.display_name ILIKE $2 ESCAPE '\\'
               OR (length($4) >= 4 AND (similarity(lower(u.username), lower($4)) > 0.55 OR similarity(lower(u.display_name), lower($4)) > 0.45)))
        ORDER BY (lower(u.username) = lower($4)) DESC, (u.username ILIKE $3 ESCAPE '\\') DESC, following DESC,
                 greatest(similarity(lower(u.username), lower($4)), similarity(lower(u.display_name), lower($4))) DESC, followers DESC, u.username ASC
        LIMIT 15`,
      [viewerId, contains, prefix, term],
    );

    return {
      query: term,
      people: people.rows.map((r) => ({
        username: r.username,
        displayName: r.display_name,
        isPrivate: r.is_private,
        verified: r.verified as boolean,
        following: r.following,
        requested: r.requested,
        followsYou: r.follows_you,
      })),
      tags: await this.tagsLike(viewerId, term),
      posts: await this.posts.search(viewerId, term, 12),
    };
  }

  /** Pessoas (por id, pela ordem do Elasticsearch) que quem pesquisa pode ver: ativas, sem bloqueios. */
  private async peopleByIds(viewerId: string, ids: string[]) {
    const { rows } = await this.pool.query(
      `SELECT u.username, u.display_name, u.is_private, u.verified,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS following,
              EXISTS (SELECT 1 FROM social.follow_requests r WHERE r.requester_id = $1 AND r.target_id = u.id) AS requested,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id AND f.followee_id = $1) AS follows_you
         FROM identity.users u
        WHERE u.id = ANY($2::uuid[]) AND u.status = 'active' AND u.id <> $1 AND NOT ${blockedBetween('u.id', '$1')} AND ${inMyNetwork('u.id', 'u.country')}
        ORDER BY array_position($2::uuid[], u.id)`,
      [viewerId, ids],
    );
    return rows.map((r) => ({ username: r.username, displayName: r.display_name, isPrivate: r.is_private, verified: r.verified as boolean, following: r.following, requested: r.requested, followsYou: r.follows_you }));
  }

  /** Hashtags que começam por `text` (com quantas publicações públicas as usam). */
  async tagsLike(viewerId: string, text: string, limit = 8) {
    const t = normalizeTag(text.replace(/^#/, ''));
    if (t.length < 1 || !/^[a-z0-9_]+$/.test(t)) return [];
    const { rows } = await this.pool.query(
      `SELECT t.tag, count(*)::int AS posts FROM content.post_tags t JOIN content.posts p ON p.id = t.post_id JOIN identity.users u ON u.id = p.author_id
        WHERE t.tag LIKE $1 AND ${PUBLIC_POST} AND ${inMyNetwork('p.author_id', 'p.country', '$3')} GROUP BY t.tag ORDER BY count(*) DESC, t.tag LIMIT $2`,
      [`${t}%`, limit, viewerId],
    );
    return rows.map((r) => ({ tag: r.tag as string, posts: r.posts as number }));
  }

  /**
   * Em alta: as hashtags mais usadas nas últimas 48 h, a pesar mais quem as usa em muitas contas diferentes
   * (para um só utilizador não "fabricar" tendências) e as que estão a crescer agora (últimas 12 h).
   */
  async trending(viewerId: string, limit = 10) {
    // Cada país tem as suas tendências.
    const country = ((await this.pool.query('SELECT country FROM identity.users WHERE id = $1', [viewerId])).rows[0]?.country as string | null) ?? '-';
    const hit = this.trendingCache.get(country);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    const { rows } = await this.pool.query(
      `SELECT t.tag, count(DISTINCT p.id)::int AS posts, count(DISTINCT p.author_id)::int AS authors,
              count(DISTINCT p.id) FILTER (WHERE p.created_at > now() - interval '12 hours')::int AS recent
         FROM content.post_tags t JOIN content.posts p ON p.id = t.post_id JOIN identity.users u ON u.id = p.author_id
        WHERE t.created_at > now() - interval '48 hours' AND ${PUBLIC_POST} AND coalesce(p.country, '-') = $2
        GROUP BY t.tag HAVING count(DISTINCT p.author_id) >= 1
        ORDER BY (count(DISTINCT p.author_id) * 2 + count(DISTINCT p.id) + count(DISTINCT p.id) FILTER (WHERE p.created_at > now() - interval '12 hours')) DESC, t.tag
        LIMIT $1`,
      [limit, country],
    );
    const value = { tags: rows.map((r) => ({ tag: r.tag as string, posts: r.posts as number, authors: r.authors as number, rising: r.recent * 2 >= r.posts && r.posts > 1 })) };
    this.trendingCache.set(country, { at: Date.now(), value });
    return value;
  }

  /** Sugestões enquanto se escreve: poucas pessoas e hashtags, rápidas. */
  async suggest(viewerId: string, raw: string) {
    const r = await this.search(viewerId, raw);
    return { people: r.people.slice(0, 5), tags: r.tags.slice(0, 5) };
  }

  /** Quantas publicações visíveis para quem pede têm esta hashtag. */
  async tagInfo(viewerId: string, tag: string) {
    const t = normalizeTag(tag);
    if (!isValidTag(t)) return null;
    const { rows } = await this.pool.query(
      `SELECT count(DISTINCT p.id)::int AS posts, count(DISTINCT p.author_id)::int AS authors
         FROM content.post_tags t JOIN content.posts p ON p.id = t.post_id JOIN identity.users u ON u.id = p.author_id
        WHERE t.tag = $1 AND ${PUBLIC_POST} AND ${inMyNetwork('p.author_id', 'p.country', '$2')}`,
      [t, viewerId],
    );
    return { tag: t, posts: rows[0].posts as number, authors: rows[0].authors as number };
  }
}

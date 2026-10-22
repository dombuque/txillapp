import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { PostsService } from '../posts/posts.service';
import { blockedBetween } from '../social/visibility';

/** Escapa % _ \ para usar o texto da pesquisa em ILIKE sem que vire padrão. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

@Injectable()
export class SearchService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly posts: PostsService,
  ) {}

  /**
   * Pesquisa de pessoas (por @ ou nome) e de publicações (texto ou local). Respeita bloqueios, contas eliminadas
   * e perfis privados: só aparecem publicações que o espectador já podia ver.
   */
  async search(viewerId: string, raw: string) {
    const term = raw.trim().replace(/^@/, '').slice(0, 50);
    if (term.length < 2) return { query: term, people: [], posts: [] };
    const contains = `%${escapeLike(term)}%`;
    const prefix = `${escapeLike(term)}%`;

    const people = await this.pool.query(
      `SELECT u.username, u.display_name, u.is_private,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS following,
              EXISTS (SELECT 1 FROM social.follow_requests r WHERE r.requester_id = $1 AND r.target_id = u.id) AS requested,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id AND f.followee_id = $1) AS follows_you,
              (SELECT count(*) FROM social.follows f WHERE f.followee_id = u.id)::int AS followers
         FROM identity.users u
        WHERE u.status = 'active' AND u.id <> $1 AND NOT ${blockedBetween('u.id', '$1')}
          AND (u.username ILIKE $2 ESCAPE '\\' OR u.display_name ILIKE $2 ESCAPE '\\')
        ORDER BY (lower(u.username) = lower($4)) DESC, (u.username ILIKE $3 ESCAPE '\\') DESC, following DESC, followers DESC, u.username ASC
        LIMIT 15`,
      [viewerId, contains, prefix, term],
    );

    return {
      query: term,
      people: people.rows.map((r) => ({
        username: r.username,
        displayName: r.display_name,
        isPrivate: r.is_private,
        following: r.following,
        requested: r.requested,
        followsYou: r.follows_you,
      })),
      posts: await this.posts.search(viewerId, contains, 12),
    };
  }
}

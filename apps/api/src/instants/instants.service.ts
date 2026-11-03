import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { MediaService } from '../media/media.service';
import { TextFilter } from '../safety/text-filter.service';
import { blockedBetween } from '../social/visibility';

const MAX_ACTIVE = 10;

/** Quem vê um Zás (`i` = alias da tabela): quem o fez; os amigos próximos dele; e, se for para "amigos", quem se segue mutuamente. Nunca com bloqueios. */
const visible = (i = 'i', v = '$1') =>
  `(${i}.author_id = ${v} OR (NOT ${blockedBetween(`${i}.author_id`, v)} AND (
      EXISTS (SELECT 1 FROM social.close_friends cf WHERE cf.owner_id = ${i}.author_id AND cf.friend_id = ${v})
      OR (${i}.audience = 'friends'
          AND EXISTS (SELECT 1 FROM social.follows f1 WHERE f1.follower_id = ${v} AND f1.followee_id = ${i}.author_id)
          AND EXISTS (SELECT 1 FROM social.follows f2 WHERE f2.follower_id = ${i}.author_id AND f2.followee_id = ${v})))))`;

@Injectable()
export class InstantsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly media: MediaService,
    private readonly filter: TextFilter,
  ) {}

  async create(me: string, mediaId: string, caption: string, audience: 'friends' | 'close' = 'friends') {
    this.filter.assertClean(caption);
    const active = (await this.pool.query('SELECT count(*)::int AS n FROM social.instants WHERE author_id = $1 AND expires_at > now()', [me])).rows[0].n as number;
    if (active >= MAX_ACTIVE) throw new BadRequestException('Já tens muitos Instants ativos. Espera que alguns acabem.');
    const ok = await this.pool.query(
      `SELECT 1 FROM content.media_assets a
        WHERE a.id = $1 AND a.owner_id = $2 AND a.purpose = 'chat' AND a.status = 'ready' AND a.mime LIKE 'image/%'
          AND NOT EXISTS (SELECT 1 FROM social.instants i WHERE i.media_id = a.id)`,
      [mediaId, me],
    );
    if (!ok.rowCount) throw new BadRequestException('Foto inválida ou ainda não carregada');
    const id = uuidv7();
    const r = await this.pool.query('INSERT INTO social.instants (id, author_id, media_id, caption, audience) VALUES ($1, $2, $3, $4, $5) RETURNING expires_at', [id, me, mediaId, caption, audience]);
    return { id, expiresAt: r.rows[0].expires_at as string };
  }

  /** A faixa: quem tem Instants por ver (os que já vi desaparecem) e os meus, com quantas pessoas os viram. */
  async tray(me: string) {
    const others = (
      await this.pool.query(
        `SELECT u.username, u.display_name AS "displayName", (u.avatar_media_id IS NOT NULL) AS "hasAvatar", count(*)::int AS count, max(i.created_at) AS "latestAt", (array_agg(i.media_id ORDER BY i.created_at DESC))[1] AS media
           FROM social.instants i
           JOIN identity.users u ON u.id = i.author_id
          WHERE i.expires_at > now() AND i.author_id <> $1 AND ${visible('i')}
            AND NOT EXISTS (SELECT 1 FROM social.instant_views v WHERE v.instant_id = i.id AND v.viewer_id = $1)
            AND EXISTS (SELECT 1 FROM content.media_assets a WHERE a.id = i.media_id AND a.status = 'ready')
          GROUP BY u.id ORDER BY max(i.created_at) DESC LIMIT 40`,
        [me],
      )
    ).rows.map(({ media, ...o }) => ({ ...o, previewUrl: this.media.chatUrl(media as string) }));
    const mine = (
      await this.pool.query(
        `SELECT count(*)::int AS count, coalesce(sum((SELECT count(*) FROM social.instant_views v WHERE v.instant_id = i.id)), 0)::int AS views, min(i.expires_at) AS "endsAt"
           FROM social.instants i WHERE i.author_id = $1 AND i.expires_at > now()`,
        [me],
      )
    ).rows[0];
    return { mine, others };
  }

  /** Os Instants de uma pessoa: os dela todos, os dos outros só os que ainda não vi. */
  async of(me: string, username: string) {
    const a = (await this.pool.query("SELECT id FROM identity.users WHERE lower(username) = lower($1) AND status <> 'deleted'", [username])).rows[0];
    if (!a) throw new NotFoundException('Pessoa não encontrada');
    const own = a.id === me;
    const { rows } = await this.pool.query(
      `SELECT i.id, i.media_id, i.caption, i.created_at, i.expires_at, (SELECT count(*)::int FROM social.instant_views v WHERE v.instant_id = i.id) AS views
         FROM social.instants i
        WHERE i.author_id = $2 AND i.expires_at > now() AND ${visible('i')}
          AND ($2 = $1 OR NOT EXISTS (SELECT 1 FROM social.instant_views v WHERE v.instant_id = i.id AND v.viewer_id = $1))
          AND EXISTS (SELECT 1 FROM content.media_assets m WHERE m.id = i.media_id AND m.status = 'ready')
        ORDER BY i.created_at`,
      [me, a.id],
    );
    return rows.map((r) => ({ id: r.id as string, url: this.media.chatUrl(r.media_id as string), caption: r.caption as string, at: r.created_at as string, expiresAt: r.expires_at as string, ...(own ? { views: r.views as number } : {}) }));
  }

  /** Marca como visto (só uma vez; quem fez não conta). */
  async view(me: string, id: string) {
    const r = await this.pool.query(
      `INSERT INTO social.instant_views (instant_id, viewer_id)
       SELECT i.id, $1 FROM social.instants i WHERE i.id = $2 AND i.author_id <> $1 AND i.expires_at > now() AND ${visible('i')}
       ON CONFLICT DO NOTHING`,
      [me, id],
    );
    return r.rowCount;
  }

  /** Quem viu o meu Instant. */
  async viewers(me: string, id: string) {
    const own = await this.pool.query('SELECT 1 FROM social.instants WHERE id = $1 AND author_id = $2', [id, me]);
    if (!own.rowCount) throw new NotFoundException('Instant não encontrado');
    const { rows } = await this.pool.query(
      `SELECT u.username, u.display_name AS "displayName", (u.avatar_media_id IS NOT NULL) AS "hasAvatar", v.viewed_at AS "at"
         FROM social.instant_views v JOIN identity.users u ON u.id = v.viewer_id WHERE v.instant_id = $1 ORDER BY v.viewed_at DESC LIMIT 200`,
      [id],
    );
    return rows;
  }

  async remove(me: string, id: string) {
    const r = await this.pool.query('DELETE FROM social.instants WHERE id = $1 AND author_id = $2', [id, me]);
    if (!r.rowCount) throw new NotFoundException('Instant não encontrado');
  }
}

import { OnModuleInit, BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { MusicService, type MusicInput } from '../music/music.service';
import { TextFilter } from '../safety/text-filter.service';
import { Pool, PoolClient } from 'pg';
import { uuidv7 } from '../common/uuid7';
import type { VerifiedTier } from '../common/badge';
import { PG_POOL } from '../db/db.module';
import { NotificationsService, mentionableBy } from '../notifications/notifications.service';
import { allowedBy, blockedBetween, canView, inMyNetwork, listVisibleTo } from '../social/visibility';
import { SearchIndexer } from '../search/search-index';
import { extractHashtags, prefixQuery } from '../common/hashtags';
import { TOPICS, classify, topicLabel } from '../common/topics';
import { coarse, notHiddenVenuePost, postGeo } from '../nearby/geo-sql';

const TOPIC_IDS = new Set(TOPICS.map((t) => t.id));
import { RANKED_SQL, decodeCursor, encodeCursor, tchekaPost } from './feed';
import { WalletService } from '../wallet/wallet.service';
import { MUSIC_SOUND_OK, POST_SOUND_SQL, SoundsService, type PostSound } from '../sounds/sounds.service';

export const MAX_PHOTOS = 10;

/** Como se dá um presente: discreto, mensagem privada ao destinatário, ou post no feed. */
export type GiftVisibility = 'silent' | 'private' | 'public';

/** Descoberta por sítio: só autores com 18 anos ou mais (ou o próprio). Sem data de nascimento conta como menor. */
export interface FeedSettings {
  following: 'less' | 'balanced' | 'more';
  freshness: 'recent' | 'balanced' | 'popular';
  media: 'all' | 'photos' | 'videos';
  variety: 'low' | 'normal' | 'high';
  hideSeen: boolean;
  calm: boolean;
}
export const DEFAULT_FEED_SETTINGS: FeedSettings = { following: 'balanced', freshness: 'balanced', media: 'all', variety: 'normal', hideSeen: false, calm: false };
/** Os temas que o "modo tranquilo" deixa de mostrar. */
const CALM_TOPICS = ['festa', 'bebidas'];

const ADULT = "(u.birth_date <= (current_date - interval '18 years') OR p.author_id = $1)";

const FEED_SQL = `
  SELECT p.id, p.short_code, p.body, p.music, p.location_label, p.created_at, p.edited_at, p.comments_off, ${postGeo('lat', 'p', 'pv', '$1')} AS location_lat, ${postGeo('lng', 'p', 'pv', '$1')} AS location_lng, p.kind, p.gift_amount, p.repost_of,
         u.id AS author_id, u.username, u.display_name, u.verified AS author_verified, u.verified_tier AS author_tier,
         (p.author_id = $1) AS by_viewer,
         pv.slug AS venue_slug, pv.name AS venue_name, pv.kind AS venue_kind, pv.verified AS venue_verified, pv.avatar_media_id AS venue_avatar,
         gr.username AS gift_username, gr.display_name AS gift_display_name, (gr.avatar_media_id IS NOT NULL) AS gift_has_avatar, gr.verified AS gift_verified, gr.verified_tier AS gift_tier,
         (${allowedBy('u', 'comments_allowed')} AND NOT p.comments_off) AS can_comment,
         ${allowedBy('u', 'gifts_allowed')} AS can_gift,
         ${listVisibleTo('u', 'reposts_visible')} AS reposts_list, ${listVisibleTo('u', 'cheers_visible')} AS cheers_list, ${listVisibleTo('u', 'gifts_visible')} AS gifts_list,
         EXISTS (SELECT 1 FROM social.follows af2 WHERE af2.follower_id = $1 AND af2.followee_id = u.id) AS author_followed,
         (SELECT count(*) FROM content.posts rp WHERE rp.repost_of = p.id AND rp.kind = 'repost' AND rp.removed_at IS NULL)::int AS reposts,
         EXISTS (SELECT 1 FROM content.posts rp WHERE rp.repost_of = p.id AND rp.author_id = $1 AND rp.kind = 'repost' AND rp.body = '' AND rp.removed_at IS NULL) AS reposted,
         (SELECT COALESCE(json_agg(json_build_object('id', pm.media_id, 'video', (ma.mime LIKE 'video/%'), 'durationMs', ma.duration_ms, 'w', ma.width, 'h', ma.height, 'tags',
                  (SELECT COALESCE(json_agg(json_build_object('username', tu.username, 'displayName', tu.display_name, 'verified', tu.verified, 'verifiedTier', tu.verified_tier, 'x', t.x, 'y', t.y)), '[]'::json)
                     FROM content.photo_tags t JOIN identity.users tu ON tu.id = t.tagged_id
                    WHERE t.media_id = pm.media_id AND t.post_id = p.id AND tu.status = 'active' AND NOT ${blockedBetween('tu.id', '$1')})
                ) ORDER BY pm.position), '[]'::json)
            FROM content.post_media pm JOIN content.media_assets ma ON ma.id = pm.media_id WHERE pm.post_id = p.id) AS media,
         (SELECT count(*) FROM content.cheers c WHERE c.post_id = p.id)::int AS cheers,
         (SELECT count(*) FROM content.comments c WHERE c.post_id = p.id)::int AS comments,
         (SELECT count(*) FROM content.gifts g WHERE g.post_id = p.id)::int AS gifts,
         EXISTS (SELECT 1 FROM content.cheers c WHERE c.post_id = p.id AND c.user_id = $1) AS cheered,
         EXISTS (SELECT 1 FROM content.saved_posts sv WHERE sv.post_id = p.id AND sv.user_id = $1) AS saved,
         ${POST_SOUND_SQL('p')} AS sound, ${MUSIC_SOUND_OK('p')} AS music_ok
    FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL
    LEFT JOIN identity.users gr ON gr.id = p.gift_recipient_id
    LEFT JOIN content.venues pv ON pv.id = p.venue_id`;

export interface PhotoTag {
  username: string;
  displayName: string;
  verified?: boolean;
  verifiedTier?: VerifiedTier | null;
  x: number;
  y: number;
}

export type ProfileTab = 'posts' | 'reels' | 'reposts' | 'gifts' | 'tagged';
export const PROFILE_TABS: readonly ProfileTab[] = ['posts', 'reels', 'reposts', 'gifts', 'tagged'];

@Injectable()
export class PostsService implements OnModuleInit {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly wallet: WalletService,
    private readonly notifications: NotificationsService,
    private readonly indexer: SearchIndexer,
    private readonly filter: TextFilter,
    private readonly musicSvc: MusicService,
    private readonly sounds: SoundsService,
  ) {}

  onModuleInit() {
    // Em segundo plano: não atrasa o arranque.
    void this.backfillTopics().catch(() => undefined);
  }

  /**
   * `soundId` («Usar este som», docs/sons.md): só numa tcheka; o servidor valida o som e guarda a música dele. Sem `soundId`,
   * uma tcheka com música do catálogo ou de um artista liga-se ao som dessa faixa, e uma tcheka sem música (com o som do
   * próprio vídeo) ganha um som original, tirado em segundo plano.
   */
  async create(userId: string, body: string, locationLabel?: string, mediaIds: string[] = [], tags: { index: number; username: string; x: number; y: number }[] = [], musicIn: MusicInput | null = null, geo: { lat: number; lng: number; coarse?: boolean } | null = null, venueId: string | null = null, soundId: string | null = null) {
    this.filter.assertClean(body, locationLabel, musicIn?.title, 'artist' in (musicIn ?? {}) ? (musicIn as { artist?: string }).artist : undefined);
    // Uma tcheka: um só vídeo, meu e já pronto (a validação completa dos ficheiros é mais abaixo).
    const tcheka = mediaIds.length === 1 && !!(await this.pool.query(`SELECT 1 FROM content.media_assets WHERE id = $1 AND owner_id = $2 AND mime LIKE 'video/%'`, [mediaIds[0], userId])).rowCount;
    let music: Record<string, unknown> | null;
    let linkedSound: string | null = null;
    if (soundId) {
      const use = await this.sounds.prepareUse(userId, soundId, musicIn, { tcheka });
      music = use.music;
      linkedSound = use.soundId;
    } else {
      music = await this.musicSvc.prepare(userId, musicIn, 'post', mediaIds);
      if (tcheka && music) linkedSound = await this.sounds.ensureTrackSound(music);
    }
    // Ligada a um local no mapa: guarda-se a posição do local (pública) tal como está.
    let fromVenue = false;
    if (venueId) {
      // Publicar como um local: só o dono e os gestores ativos da página. O sítio da publicação passa a ser o próprio local.
      const v = await this.pool.query(
        `SELECT v.name, v.lat, v.lng, v.review_status, v.show_on_map FROM content.venues v WHERE v.id = $1
            AND (v.owner_id = $2 OR EXISTS (SELECT 1 FROM content.venue_managers m WHERE m.venue_id = v.id AND m.user_id = $2 AND m.status = 'active'))`,
        [venueId, userId],
      );
      if (!v.rowCount) throw new ForbiddenException('Só os gestores podem publicar como este local');
      if (v.rows[0].review_status !== 'approved') throw new ForbiddenException('O local ainda está em análise. Podes publicar como o local depois de a equipa o aprovar.');
      locationLabel = v.rows[0].name as string;
      // Local fora do mapa: a publicação não leva posição (nem a do local, nem a de quem publica).
      if (v.rows[0].show_on_map === false) geo = null;
      else if (v.rows[0].lat != null && v.rows[0].lng != null) {
        geo = { lat: v.rows[0].lat as number, lng: v.rows[0].lng as number };
        fromVenue = true;
      }
    }
    if (mediaIds.length > MAX_PHOTOS) throw new BadRequestException(`No máximo ${MAX_PHOTOS} fotos por publicação`);
    if (new Set(mediaIds).size !== mediaIds.length) throw new BadRequestException('Fotos repetidas');
    if (!body.trim() && mediaIds.length === 0) throw new BadRequestException('Escreve algo ou mete uma foto');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (mediaIds.length) {
        // Só fotos do próprio autor, já carregadas e ainda não usadas noutro post.
        const ok = await client.query(
          `SELECT count(*)::int AS n FROM content.media_assets a
            WHERE a.id = ANY($1) AND a.owner_id = $2 AND a.status = 'ready'
              AND NOT EXISTS (SELECT 1 FROM content.post_media pm WHERE pm.media_id = a.id)`,
          [mediaIds, userId],
        );
        if (ok.rows[0].n !== mediaIds.length) throw new BadRequestException('Ficheiro inválido ou ainda não processado');
        // Fotos e vídeos podem ir juntos (carrossel). Um vídeo sozinho é uma tcheka.
      }
      const id = uuidv7();
      // A posição do SÍTIO escolhido, arredondada a 2 casas (~1 km): nunca a posição exata de quem publica.
      // Só a de um local no mapa (sítio público) vai tal como está.
      // Menores de 18 anos: só o nome do sítio, nunca a posição (e ficam fora da descoberta por sítio).
      const adult = !!geo && !!(await client.query("SELECT 1 FROM identity.users WHERE id = $1 AND birth_date <= (current_date - interval '18 years')", [userId])).rowCount;
      if (!adult) geo = null;
      const q = (n: number) => (fromVenue ? n : coarse(n));
      await client.query('INSERT INTO content.posts (id, author_id, body, location_label, music, location_lat, location_lng, topics, venue_id, sound_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [
        id, userId, body.trim(), locationLabel || null, music ? JSON.stringify(music) : null, locationLabel && geo ? q(geo.lat) : null, locationLabel && geo ? q(geo.lng) : null, classify(`${body} ${locationLabel ?? ''}`, extractHashtags(body)), venueId, linkedSound,
      ]);
      for (const tag of extractHashtags(body)) {
        await client.query('INSERT INTO content.post_tags (post_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, tag]);
      }
      for (const [i, mediaId] of mediaIds.entries()) {
        await client.query('INSERT INTO content.post_media (post_id, media_id, position) VALUES ($1, $2, $3)', [id, mediaId, i]);
      }
      // Identificações: só quem eu posso mencionar (mesma regra das @menções) e que consegue ver a minha conta.
      const tagged: string[] = [];
      for (const t of tags) {
        if (!mediaIds[t.index]) throw new BadRequestException('Identificação numa foto que não existe');
        const who = await client.query(
          `SELECT u.id FROM identity.users u, identity.users au
            WHERE au.id = $1 AND lower(u.username) = lower($2) AND ${mentionableBy('u', '$1')} AND ${canView('au', 'u.id')}`,
          [userId, t.username],
        );
        if (!who.rows[0]) throw new BadRequestException(`Não podes identificar @${t.username}`);
        const ins = await client.query(
          'INSERT INTO content.photo_tags (id, post_id, media_id, tagged_id, x, y) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
          [uuidv7(), id, mediaIds[t.index], who.rows[0].id, t.x, t.y],
        );
        if (ins.rowCount && !tagged.includes(who.rows[0].id)) tagged.push(who.rows[0].id);
      }
      await client.query('COMMIT');
      this.indexer.postChanged(id);
      // Tcheka com o som do próprio vídeo: o som original tira-se em segundo plano (não atrasa a publicação).
      if (tcheka && !music && !venueId) void this.sounds.queueOriginal(id);
      for (const tid of tagged) void this.notifications.notify({ userId: tid, actorId: userId, kind: 'tag', data: { postId: id } });
      void this.notifications.notifyMentions(userId, body, { postId: id, snippet: body.trim().slice(0, 80) });
      return this.getOne(userId, id);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Quem repostou, brindou ou presenteou: só se o dono permitir (definições) e só pessoas que este espectador pode ver. */
  async people(viewerId: string, postId: string, kind: 'reposts' | 'cheers' | 'gifts') {
    const col = { reposts: 'reposts_visible', cheers: 'cheers_visible', gifts: 'gifts_visible' }[kind];
    const post = await this.pool.query(
      `SELECT ${listVisibleTo('u', col)} AS allowed FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL
        WHERE p.id = $2 AND ${canView('u')}`,
      [viewerId, postId],
    );
    if (!post.rows[0]) throw new NotFoundException('Publicação não encontrada');
    if (!post.rows[0].allowed) throw new ForbiddenException('O dono desta publicação não mostra esta lista');
    const source = {
      reposts: `SELECT rp.author_id AS who, rp.created_at AS at FROM content.posts rp WHERE rp.repost_of = $2 AND rp.kind = 'repost' AND rp.removed_at IS NULL`,
      cheers: `SELECT c.user_id AS who, c.created_at AS at FROM content.cheers c WHERE c.post_id = $2`,
      gifts: `SELECT g.sender_id AS who, max(g.created_at) AS at FROM content.gifts g WHERE g.post_id = $2 GROUP BY g.sender_id`,
    }[kind];
    const { rows } = await this.pool.query(
      `SELECT a.username, a.display_name, (a.avatar_media_id IS NOT NULL) AS has_avatar, a.verified, a.verified_tier, s.at
         FROM (${source}) s JOIN identity.users a ON a.id = s.who
        WHERE ${canView('a')} ORDER BY s.at DESC LIMIT 100`,
      [viewerId, postId],
    );
    return rows.map((r) => ({ username: r.username, displayName: r.display_name, hasAvatar: r.has_avatar, verified: r.verified, verifiedTier: (r.verified_tier as string | null) ?? null, at: r.at }));
  }

  /** Apagar a própria publicação: fica escondida para todos (reposts dela também deixam de aparecer). */
  /** O autor edita o texto e/ou liga/desliga os comentários. Só as publicações dele; o texto passa pelo mesmo filtro. */
  async update(userId: string, postId: string, b: { body?: string; commentsOff?: boolean; clearLocation?: boolean }) {
    const cur = (await this.pool.query('SELECT body, kind, (SELECT count(*) FROM content.post_media m WHERE m.post_id = p.id)::int AS media FROM content.posts p WHERE id = $1 AND author_id = $2 AND removed_at IS NULL', [postId, userId])).rows[0];
    if (!cur) throw new NotFoundException('Publicação não encontrada');
    if (b.body !== undefined) {
      const body = b.body.trim();
      if (cur.kind === 'repost' && cur.body === '') throw new BadRequestException('Um repost simples não se edita');
      if (!body && cur.media === 0) throw new BadRequestException('Escreve algo');
      this.filter.assertClean(body);
      if (body !== cur.body) {
        await this.pool.query('UPDATE content.posts SET body = $2, edited_at = now(), topics = $3 WHERE id = $1', [postId, body, classify(body, extractHashtags(body))]);
        await this.pool.query('DELETE FROM content.post_tags WHERE post_id = $1', [postId]);
        for (const tag of extractHashtags(body)) await this.pool.query('INSERT INTO content.post_tags (post_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, tag]);
        this.indexer.postChanged(postId);
      }
    }
    if (b.commentsOff !== undefined) await this.pool.query('UPDATE content.posts SET comments_off = $2 WHERE id = $1', [postId, b.commentsOff]);
    // O autor pode tirar o local a qualquer momento (nome e posição).
    if (b.clearLocation) await this.pool.query('UPDATE content.posts SET location_label = NULL, location_lat = NULL, location_lng = NULL WHERE id = $1', [postId]);
    return this.getOne(userId, postId);
  }

  async removeOwn(userId: string, postId: string) {
    const r = await this.pool.query(
      `UPDATE content.posts SET removed_at = now(), removed_by = 'author' WHERE id = $1 AND author_id = $2 AND removed_at IS NULL`,
      [postId, userId],
    );
    if (!r.rowCount) throw new NotFoundException('Publicação não encontrada');
    this.indexer.postRemoved(postId);
  }

  /** Quem foi identificado pode tirar a sua identificação de uma publicação. */
  async untagMe(userId: string, postId: string) {
    await this.pool.query('DELETE FROM content.photo_tags WHERE post_id = $1 AND tagged_id = $2', [postId, userId]);
    return this.getOne(userId, postId);
  }

  /**
   * Feed por relevância (ver feed.ts). Cada página traz até `limit` publicações; `nextCursor` continua a mesma sessão.
   * Cada item leva `feed`: de onde vem ("following", "self", "discover") e se já foi visto numa sessão anterior.
   */
  async rankedFeed(userId: string, token: string | undefined, limit: number, mode: 'feed' | 'reels' = 'feed') {
    const cur = decodeCursor(token);
    const session = cur?.t ?? new Date().toISOString();
    const bucket = String(Math.floor(Date.parse(session) / 1_800_000)); // variedade estável durante ~30 min
    const { rows: ranked } = await this.pool.query(RANKED_SQL, [userId, session, bucket, cur?.s ?? null, cur?.id ?? null, limit + 1, mode === 'reels', mode === 'reels' ? -0.1 : -0.6]);
    const page = ranked.slice(0, limit);
    const meta = new Map(page.map((r) => [r.id as string, { source: r.source as 'following' | 'self' | 'discover', seen: r.seen as boolean }]));
    let items: Awaited<ReturnType<PostsService['hydrate']>> = [];
    if (page.length) {
      const { rows } = await this.pool.query(`${FEED_SQL} WHERE p.id = ANY($2) AND ${canView()}`, [userId, page.map((r) => r.id)]);
      const order = new Map(page.map((r, i) => [r.id as string, i]));
      rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      items = await this.hydrate(userId, rows);
    }
    const last = page[page.length - 1];
    return {
      items: items.map((i) => ({ ...i, feed: meta.get(i.id) ?? { source: 'following' as const, seen: false } })),
      nextCursor: ranked.length > limit && last ? encodeCursor({ s: last.score, id: last.id, t: session, n: (cur?.n ?? 0) + items.length }) : null,
    };
  }

  /** O telemóvel avisa que estas publicações apareceram no ecrã: na próxima sessão descem para dar lugar a novidades. */
  async markSeen(userId: string, ids: string[]) {
    if (!ids.length) return;
    await this.pool.query(
      `INSERT INTO content.feed_impressions (user_id, post_id, seen_at)
       SELECT $1, p.id, now() FROM content.posts p WHERE p.id = ANY($2::uuid[])
       ON CONFLICT (user_id, post_id) DO UPDATE SET seen_at = now()`,
      [userId, ids],
    );
  }

  /**
   * "N publicações novas" no cabeçalho da conversa: o que esta pessoa publicou de raiz nos últimos 7 dias (sem reposts nem
   * presentes sobre a publicação de outra pessoa; o que publicou como um local fica na página do local, como no perfil),
   * que eu posso ver (canView: conta ativa, sem bloqueio, pública ou sigo) e que ainda não me apareceu (sem linha minha em
   * feed_impressions, o mesmo "visto" do Início). `latestId` = a mais recente. Usa posts_author_idx e a chave de feed_impressions.
   */
  async newPostsBy(viewerId: string, authorId: string): Promise<{ count: number; latestId: string | null }> {
    if (viewerId === authorId) return { count: 0, latestId: null };
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS n, (array_agg(p.id ORDER BY p.id DESC))[1] AS latest
         FROM content.posts p JOIN identity.users u ON u.id = p.author_id
        WHERE p.author_id = $2 AND p.removed_at IS NULL AND p.repost_of IS NULL AND p.venue_id IS NULL
          AND p.created_at > now() - interval '7 days'
          AND ${canView()}
          AND NOT EXISTS (SELECT 1 FROM content.feed_impressions i WHERE i.user_id = $1 AND i.post_id = p.id)`,
      [viewerId, authorId],
    );
    return { count: (rows[0]?.n as number) ?? 0, latestId: (rows[0]?.latest as string | null) ?? null };
  }

  /** "Não me interessa": esta publicação não volta a aparecer no feed. */
  async hideFromFeed(userId: string, postId: string) {
    const r = await this.pool.query(
      `INSERT INTO content.feed_impressions (user_id, post_id, hidden) SELECT $1, p.id, true FROM content.posts p WHERE p.id = $2
       ON CONFLICT (user_id, post_id) DO UPDATE SET hidden = true, seen_at = now()`,
      [userId, postId],
    );
    if (!r.rowCount) throw new NotFoundException('Publicação não encontrada');
  }

  /** Feed global (MVP) com paginação por cursor: ids UUIDv7 são ordenáveis no tempo. */
  async feed(userId: string, cursor: string | undefined, limit: number) {
    if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new BadRequestException('cursor inválido');
    const { rows } = await this.pool.query(
      `${FEED_SQL} WHERE ($2::uuid IS NULL OR p.id < $2) AND ${canView()} ORDER BY p.id DESC LIMIT $3`,
      [userId, cursor ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return { items: await this.hydrate(userId, page), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }

  /**
   * Junta, a cada repost, a publicação original (só se o espectador ainda a pode ver: se o autor passou a privado,
   * bloqueou ou eliminou a conta, o repost desaparece com ela).
   */
  private async hydrate(viewerId: string, rows: Record<string, any>[]) {
    const load = async (ids: (string | null)[]) => {
      const found = new Map<string, Record<string, any>>();
      const unique = [...new Set(ids.filter(Boolean))] as string[];
      if (unique.length) {
        const o = await this.pool.query(`${FEED_SQL} WHERE p.id = ANY($2) AND ${canView()}`, [viewerId, unique]);
        for (const r of o.rows) found.set(r.id, r);
      }
      return found;
    };
    // Até dois níveis: um repost simples de uma citação mostra a citação e, dentro, o original.
    const first = await load(rows.map((r) => r.repost_of));
    const second = await load([...first.values()].map((r) => r.repost_of));
    return rows
      .filter((r) => {
        if (!r.repost_of) return true;
        const l1 = first.get(r.repost_of);
        return !!l1 && (!l1.repost_of || second.has(l1.repost_of));
      })
      .map((r) => {
        const l1 = r.repost_of ? first.get(r.repost_of)! : null;
        const inner = l1?.repost_of ? { ...this.toDto(second.get(l1.repost_of)!), repostOf: null } : null;
        return { ...this.toDto(r), repostOf: l1 ? { ...this.toDto(l1), repostOf: inner } : null };
      });
  }

  /**
   * Repostar: partilha a publicação de outra pessoa no teu perfil, sozinha ou com um comentário (citação).
   * Só publicações normais de contas públicas; nunca as tuas, de bloqueados, nem reposts de reposts.
   */
  async repost(userId: string, postId: string, body = '') {
    this.filter.assertClean(body);
    const { rows } = await this.pool.query(
      `SELECT p.author_id, p.kind, p.body, u.is_private FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL
        WHERE p.id = $2 AND ${canView()}`,
      [userId, postId],
    );
    const o = rows[0];
    if (!o) throw new NotFoundException('Publicação não encontrada');
    // Reposta-se publicações (incluindo presentes) e citações, como no X; um repost simples já mostra o original, repostas esse.
    if (!(o.kind === 'post' || o.kind === 'gift' || (o.kind === 'repost' && o.body))) throw new BadRequestException('Um repost simples não se reposta: reposta a publicação original');
    // O dono também pode repostar a sua própria publicação (como no X). Contas privadas não se repostam, nem a própria.
    if (o.is_private) throw new ForbiddenException('As publicações de contas privadas não podem ser repostadas 🔒');

    const text = body.trim().slice(0, 500);
    if (!text) {
      const existing = await this.pool.query(
        `SELECT id FROM content.posts WHERE author_id = $1 AND repost_of = $2 AND kind = 'repost' AND body = '' AND removed_at IS NULL`,
        [userId, postId],
      );
      if (existing.rows[0]) return this.getOne(userId, existing.rows[0].id);
    }
    const id = uuidv7();
    await this.pool.query(`INSERT INTO content.posts (id, author_id, body, kind, repost_of) VALUES ($1, $2, $3, 'repost', $4)`, [id, userId, text, postId]);
    await this.notifications.notify({ userId: o.author_id, actorId: userId, kind: 'repost', data: { postId, repostId: id, ...(text ? { snippet: text.slice(0, 80) } : {}) } });
    for (const tag of extractHashtags(text)) await this.pool.query('INSERT INTO content.post_tags (post_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, tag]);
    if (text) this.indexer.postChanged(id);
    if (text) void this.notifications.notifyMentions(userId, text, { postId: id, snippet: text.slice(0, 80) });
    return this.getOne(userId, id);
  }

  /** Desfaz o repost simples que fizeste desta publicação. */
  async unrepost(userId: string, postId: string) {
    await this.pool.query(`DELETE FROM content.posts WHERE author_id = $1 AND repost_of = $2 AND kind = 'repost' AND body = ''`, [userId, postId]);
    const c = await this.pool.query(`SELECT count(*)::int AS n FROM content.posts WHERE repost_of = $1 AND kind = 'repost' AND removed_at IS NULL`, [postId]);
    return { reposted: false, reposts: c.rows[0].n as number };
  }

  /** As publicações feitas como um local (a página), as mais recentes primeiro. */
  async byVenue(viewerId: string, venueId: string, cursor: string | undefined, limit: number) {
    if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new BadRequestException('cursor inválido');
    const { rows } = await this.pool.query(
      `${FEED_SQL} WHERE p.venue_id = $2 AND p.kind = 'post' AND ($3::uuid IS NULL OR p.id < $3) AND ${canView()} ORDER BY p.id DESC LIMIT $4`,
      [viewerId, venueId, cursor ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return { items: await this.hydrate(viewerId, page), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }

  /** Publicações de uma pessoa (perfil), com o mesmo formato do feed. */
  async byAuthor(viewerId: string, username: string, cursor: string | undefined, limit: number, tab: ProfileTab | 'all' = 'all') {
    if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new BadRequestException('cursor inválido');
    const hasVideo = tchekaPost();
    // Cada separador do perfil: publicações (fotos, texto e carrosséis com vídeos), tchekas (um vídeo só), reposts, presentes (dados ou recebidos) e identificações.
    const where: Record<ProfileTab | 'all', string> = {
      // "Tudo": só o que a pessoa publicou (publicações, reels e presentes). Os reposts têm o seu próprio separador.
      all: `u.username = $2 AND p.kind <> 'repost'`,
      posts: `u.username = $2 AND p.kind = 'post' AND NOT ${hasVideo}`,
      reels: `u.username = $2 AND p.kind = 'post' AND ${hasVideo}`,
      reposts: `u.username = $2 AND p.kind = 'repost'`,
      gifts: `p.kind = 'gift' AND (u.username = $2 OR gr.username = $2)`,
      tagged: `EXISTS (SELECT 1 FROM content.photo_tags pt JOIN identity.users tu ON tu.id = pt.tagged_id WHERE pt.post_id = p.id AND tu.username = $2)`,
    };
    const { rows } = await this.pool.query(
      // O que foi publicado como um local fica na página do local, não no perfil de quem o escreveu (senão denunciava o gestor).
      // Só o próprio autor o vê no seu perfil. As identificações (tagged) continuam a aparecer.
      `${FEED_SQL} WHERE ${where[tab]} AND (${tab === 'tagged' ? 'true' : 'p.venue_id IS NULL OR p.author_id = $1'}) AND ($3::uuid IS NULL OR p.id < $3) AND ${canView()} ORDER BY p.id DESC LIMIT $4`,
      [viewerId, username, cursor ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return { items: await this.hydrate(viewerId, page), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }

  /** Pesquisa por texto ou local, só em publicações que o espectador pode ver. `pattern` já vem escapado para ILIKE. */
  /**
   * Publicações por texto: texto completo em português (sem acentos, por prefixo: "prai" acha "praia"),
   * ou por parte do texto / local. As mais relevantes primeiro, depois as mais recentes.
   */
  async search(viewerId: string, term: string, limit: number) {
    const q = prefixQuery(term);
    const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    const { rows } = await this.pool.query(
      `${FEED_SQL} WHERE (
            (${'$3'}::text IS NOT NULL AND to_tsvector('portuguese', content.f_unaccent(p.body)) @@ to_tsquery('portuguese', $3))
            OR p.body ILIKE $2 ESCAPE '\\' OR p.location_label ILIKE $2 ESCAPE '\\') AND ${canView()} AND ${inMyNetwork()}
        ORDER BY (CASE WHEN $3::text IS NOT NULL THEN ts_rank(to_tsvector('portuguese', content.f_unaccent(p.body)), to_tsquery('portuguese', $3)) ELSE 0 END) DESC, p.id DESC
        LIMIT $4`,
      [viewerId, like, q, limit],
    );
    return this.hydrate(viewerId, rows);
  }

  /** Publicações por id (resultado do Elasticsearch), na mesma ordem, só as que quem pede pode ver. */
  async byIds(viewerId: string, ids: string[], limit: number) {
    if (!ids.length) return [];
    const { rows } = await this.pool.query(`${FEED_SQL} WHERE p.id = ANY($2::uuid[]) AND ${canView()} AND ${inMyNetwork()}`, [viewerId, ids]);
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return (await this.hydrate(viewerId, rows.slice(0, limit)));
  }

  /** Publicações com uma hashtag, para quem as pode ver. `top` = as que mais reações tiveram nos últimos 7 dias. */
  async byTag(viewerId: string, tag: string, sort: 'recent' | 'top', cursor: string | undefined, limit: number) {
    if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new BadRequestException('cursor inválido');
    const order =
      sort === 'top'
        ? `ORDER BY (SELECT count(*) FROM content.cheers c WHERE c.post_id = p.id) + 2 * (SELECT count(*) FROM content.comments c WHERE c.post_id = p.id) DESC, p.id DESC`
        : 'ORDER BY p.id DESC';
    // "top" não usa cursor por id (a ordem não é por id): mostra só as primeiras `limit`.
    const { rows } = await this.pool.query(
      `${FEED_SQL} WHERE EXISTS (SELECT 1 FROM content.post_tags t WHERE t.post_id = p.id AND t.tag = $2)
          AND ($3::uuid IS NULL OR p.id < $3) AND ${canView()} AND ${inMyNetwork()} ${sort === 'top' ? "AND p.created_at > now() - interval '7 days'" : ''} ${order} LIMIT $4`,
      [viewerId, tag, sort === 'top' ? null : cursor ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return { items: await this.hydrate(viewerId, page), nextCursor: sort === 'recent' && rows.length > limit ? page[page.length - 1].id : null };
  }

  /**
   * Publicações de um sítio: `at` = com este mesmo nome de sítio; `near` = perto (até 10 km) do ponto desse sítio.
   * Só o que o espectador pode ver (privacidade, bloqueios e a sua rede/país).
   */
  async byPlace(viewerId: string, label: string, mode: 'at' | 'near', cursor: string | undefined, limit: number) {
    if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new BadRequestException('cursor inválido');
    const name = label.trim().slice(0, 80);
    if (!name) throw new BadRequestException('Sítio em falta');
    // Publicações feitas como um local que saiu do mapa não contam para o ponto nem para o "perto" (a posição delas não sai).
    // O ponto do sítio: a média das posições guardadas em publicações com este nome (arredondadas).
    // Só com publicações que ESTE espectador pode ver e de adultos; a mediana impede que alguém desloque o sítio com posições falsas.
    const c = (await this.pool.query(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY p.location_lat) AS lat, percentile_cont(0.5) WITHIN GROUP (ORDER BY p.location_lng) AS lng
         FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL
        WHERE lower(p.location_label) = lower($2) AND p.location_lat IS NOT NULL AND ${notHiddenVenuePost()} AND ${ADULT} AND ${canView()} AND ${inMyNetwork()}`,
      [viewerId, name],
    )).rows[0];
    // O ponto que sai na resposta vai a 2 casas (~1 km), como a posição de cada publicação.
    const center = c?.lat != null ? { lat: Number(c.lat), lng: Number(c.lng) } : null;
    const shownCenter = center ? { lat: coarse(center.lat), lng: coarse(center.lng) } : null;
    const cond =
      mode === 'near'
        ? center
          ? `p.location_lat IS NOT NULL AND ${notHiddenVenuePost()} AND p.location_lat BETWEEN $5 - 0.1 AND $5 + 0.1 AND p.location_lng BETWEEN $6 - 0.1 / GREATEST(cos(radians($5)), 0.01) AND $6 + 0.1 / GREATEST(cos(radians($5)), 0.01)
             AND 2 * 6371 * asin(sqrt(sin(radians(p.location_lat - $5) / 2) ^ 2 + cos(radians($5)) * cos(radians(p.location_lat)) * sin(radians(p.location_lng - $6) / 2) ^ 2)) <= 10 AND $2::text IS NOT NULL`
          : 'false AND $2::text IS NOT NULL'
        : 'lower(p.location_label) = lower($2)';
    const { rows } = await this.pool.query(
      `${FEED_SQL} WHERE p.kind = 'post' AND ${ADULT} AND ${cond} AND ($3::uuid IS NULL OR p.id < $3) AND ${canView()} AND ${inMyNetwork()} ORDER BY p.id DESC LIMIT $4`,
      mode === 'near' && center ? [viewerId, name, cursor ?? null, limit + 1, center.lat, center.lng] : [viewerId, name, cursor ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return { label: name, mode, hasNear: !!center, center: shownCenter, items: await this.hydrate(viewerId, page), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }

  /** Guardar ou tirar dos guardados (privado). */
  async setSaved(userId: string, postId: string, on: boolean) {
    await this.assertPost(userId, postId);
    if (on) await this.pool.query('INSERT INTO content.saved_posts (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, postId]);
    else await this.pool.query('DELETE FROM content.saved_posts WHERE user_id = $1 AND post_id = $2', [userId, postId]);
    return { saved: on };
  }

  /** Os meus guardados, do mais recente para o mais antigo. Só o que ainda posso ver (apagadas, privadas e bloqueios ficam de fora). */
  async listSaved(userId: string, cursor: string | undefined, limit: number) {
    if (cursor && Number.isNaN(Date.parse(cursor))) throw new BadRequestException('cursor inválido');
    const { rows } = await this.pool.query(
      `${FEED_SQL} JOIN content.saved_posts sv2 ON sv2.post_id = p.id AND sv2.user_id = $1
        WHERE ($2::timestamptz IS NULL OR sv2.created_at < $2) AND ${canView()} ORDER BY sv2.created_at DESC LIMIT $3`,
      [userId, cursor ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    let next: string | null = null;
    if (rows.length > limit && page.length) {
      next = ((await this.pool.query('SELECT created_at FROM content.saved_posts WHERE user_id = $1 AND post_id = $2', [userId, page[page.length - 1].id])).rows[0]?.created_at as Date | undefined)?.toISOString() ?? null;
    }
    return { items: await this.hydrate(userId, page), nextCursor: next };
  }

  /** Classifica (em lotes) as publicações antigas que ainda não têm temas. Corre ao arrancar; é barato e só trata o que falta. */
  async backfillTopics(max = 5000) {
    let done = 0;
    while (done < max) {
      const { rows } = await this.pool.query("SELECT id, body, location_label FROM content.posts WHERE topics IS NULL AND removed_at IS NULL ORDER BY id DESC LIMIT 500");
      if (!rows.length) break;
      for (const r of rows) {
        const body = String(r.body ?? '');
        await this.pool.query('UPDATE content.posts SET topics = $2 WHERE id = $1', [r.id, classify(`${body} ${r.location_label ?? ''}`, extractHashtags(body))]);
      }
      done += rows.length;
    }
    return done;
  }

  /**
   * O algoritmo do Explorar ("Para ti"), nosso e só com dados do Txillapp:
   *  - interesse: os temas do que a pessoa brindou, comentou, guardou e das contas que segue (com pesos diferentes);
   *  - qualidade: reações por pessoa alcançada (e não só quantas), para não ganhar só quem já é grande;
   *  - frescura: decai com os dias; contas seguidas sobem um pouco; o que já viste desce;
   *  - variedade: no máximo 2 publicações por conta e uma pequena aleatoriedade diária, para descobrir coisas novas.
   * Com `topic`, só desse tema (e sem o peso do interesse). Só publicações com foto ou vídeo que a pessoa pode ver, de adultos.
   */
  async explore(viewerId: string, topic: string | null, cursor: string | undefined, limit: number, videoOnly = false, followingOnly = false) {
    const offset = cursor && /^\d{1,5}$/.test(cursor) ? Number(cursor) : 0;
    const t = topic && /^[a-z]{2,20}$/.test(topic) ? topic : null;
    const s = await this.feedSettings(viewerId);
    const k = settingsToWeights(s);
    const { rows } = await this.pool.query(
      `WITH w AS (
         SELECT topic, sum(wt) AS wt FROM (
           SELECT unnest(p.topics) AS topic, 1.0 AS wt FROM content.cheers c JOIN content.posts p ON p.id = c.post_id WHERE c.user_id = $1 AND c.created_at > now() - interval '60 days' AND p.topics IS NOT NULL
           UNION ALL SELECT unnest(p.topics), 2.0 FROM content.comments c JOIN content.posts p ON p.id = c.post_id WHERE c.author_id = $1 AND c.created_at > now() - interval '60 days' AND p.topics IS NOT NULL
           UNION ALL SELECT unnest(p.topics), 3.0 FROM content.saved_posts s JOIN content.posts p ON p.id = s.post_id WHERE s.user_id = $1 AND p.topics IS NOT NULL
           UNION ALL SELECT unnest(p.topics), 0.4 FROM social.follows f JOIN content.posts p ON p.author_id = f.followee_id AND p.created_at > now() - interval '30 days' WHERE f.follower_id = $1 AND p.topics IS NOT NULL
           UNION ALL SELECT unnest(p.topics), 2.5 * fb.value FROM content.post_feedback fb JOIN content.posts p ON p.id = fb.post_id WHERE fb.user_id = $1 AND p.topics IS NOT NULL
           UNION ALL SELECT topic, 8.0 * pref FROM social.explore_prefs WHERE user_id = $1
         ) x GROUP BY topic),
       tot AS (SELECT GREATEST(COALESCE(sum(wt), 0), 1) AS s FROM w),
       cand AS (
         SELECT p.id, p.author_id, p.topics, p.created_at,
                (SELECT count(*) FROM content.cheers c WHERE c.post_id = p.id)::float AS cheers,
                (SELECT count(*) FROM content.comments c WHERE c.post_id = p.id)::float AS comments,
                (SELECT count(*) FROM content.posts r WHERE r.repost_of = p.id AND r.kind = 'repost' AND r.removed_at IS NULL)::float AS reposts,
                (SELECT count(*) FROM content.feed_impressions i WHERE i.post_id = p.id)::float AS reach,
                EXISTS (SELECT 1 FROM content.feed_impressions i WHERE i.post_id = p.id AND i.user_id = $1) AS seen,
                EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = p.author_id) AS followed,
                EXISTS (SELECT 1 FROM content.post_media pm JOIN content.media_assets ma ON ma.id = pm.media_id WHERE pm.post_id = p.id AND ma.mime LIKE 'video/%') AS isvid,
                EXISTS (SELECT 1 FROM social.explore_people ep WHERE ep.user_id = $1 AND ep.person_id = p.author_id AND ep.pref = 1) AS boosted
           FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL
          WHERE p.kind = 'post' AND p.created_at > now() - interval '45 days' AND p.author_id <> $1
            AND EXISTS (SELECT 1 FROM content.post_media pm WHERE pm.post_id = p.id)
            AND ${ADULT} AND ${canView()} AND ${inMyNetwork()}
            AND ($2::text IS NULL OR $2 = ANY(p.topics))
            AND (NOT $5::boolean OR ${tchekaPost()})
            AND NOT EXISTS (SELECT 1 FROM content.feed_impressions hi WHERE hi.user_id = $1 AND hi.post_id = p.id AND hi.hidden)
            AND NOT EXISTS (SELECT 1 FROM content.post_feedback fb WHERE fb.user_id = $1 AND fb.post_id = p.id AND fb.value < 0)
            AND NOT EXISTS (SELECT 1 FROM social.explore_people ep WHERE ep.user_id = $1 AND ep.person_id = p.author_id AND ep.pref < 0)
            AND (NOT $12::boolean OR NOT EXISTS (SELECT 1 FROM content.feed_impressions i2 WHERE i2.post_id = p.id AND i2.user_id = $1))
            AND (NOT $13::boolean OR NOT (COALESCE(p.topics, '{}') && $14::text[]))
            AND (NOT $15::boolean OR EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = p.author_id))
          ORDER BY p.id DESC LIMIT 800),
       scored AS (
         SELECT c.id, c.author_id,
                (0.25 + 1.6 * CASE WHEN $2::text IS NULL THEN greatest(COALESCE((SELECT sum(w.wt) FROM w WHERE w.topic = ANY(c.topics)), 0), -0.2 * (SELECT s FROM tot)) / (SELECT s FROM tot) ELSE 0 END)
                * (0.4 + least(2.5, (c.cheers + 2 * c.comments + 3 * c.reposts + 1) / (c.reach + 20) * $8::float))
                * (0.3 + exp(-extract(epoch FROM (now() - c.created_at)) / 3600 / $7::float))
                * (CASE WHEN c.followed THEN $6::float ELSE 1 END)
                * (CASE WHEN c.isvid THEN $9::float ELSE $10::float END)
                * (CASE WHEN c.boosted THEN 1.8 ELSE 1 END)
                * (CASE WHEN c.seen THEN 0.45 ELSE 1 END)
                + (abs(hashtext($1::text || c.id::text || current_date::text)) % 1000) / 1000.0 * 0.06 AS score
           FROM cand c),
       ranked AS (SELECT id, score, row_number() OVER (PARTITION BY author_id ORDER BY score DESC) AS rn FROM scored)
       SELECT id FROM ranked WHERE rn <= $11::int ORDER BY score DESC OFFSET $3 LIMIT $4`,
      [viewerId, t, offset, limit + 1, videoOnly, k.followedMul, k.decayHours, k.engagement, k.videoMul, k.photoMul, k.perAuthor, s.hideSeen, s.calm, CALM_TOPICS, followingOnly],
    );
    const ids = rows.slice(0, limit).map((r) => r.id as string);
    if (!ids.length) return { items: [], nextCursor: null };
    const full = await this.pool.query(`${FEED_SQL} WHERE p.id = ANY($2)`, [viewerId, ids]);
    const order = new Map(ids.map((id, i) => [id, i]));
    full.rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return { items: await this.hydrate(viewerId, full.rows), nextCursor: rows.length > limit ? String(offset + limit) : null };
  }

  /** O que o algoritmo aprendeu contigo (só atividade: brindes, comentários, guardados, seguidos e "interessado"): os temas por ordem. */
  async activityTopics(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT topic, sum(wt) AS wt FROM (
         SELECT unnest(p.topics) AS topic, 1.0 AS wt FROM content.cheers c JOIN content.posts p ON p.id = c.post_id WHERE c.user_id = $1 AND c.created_at > now() - interval '60 days' AND p.topics IS NOT NULL
         UNION ALL SELECT unnest(p.topics), 2.0 FROM content.comments c JOIN content.posts p ON p.id = c.post_id WHERE c.author_id = $1 AND c.created_at > now() - interval '60 days' AND p.topics IS NOT NULL
         UNION ALL SELECT unnest(p.topics), 3.0 FROM content.saved_posts s JOIN content.posts p ON p.id = s.post_id WHERE s.user_id = $1 AND p.topics IS NOT NULL
         UNION ALL SELECT unnest(p.topics), 0.4 FROM social.follows f JOIN content.posts p ON p.author_id = f.followee_id AND p.created_at > now() - interval '30 days' WHERE f.follower_id = $1 AND p.topics IS NOT NULL
         UNION ALL SELECT unnest(p.topics), 2.5 * fb.value FROM content.post_feedback fb JOIN content.posts p ON p.id = fb.post_id WHERE fb.user_id = $1 AND p.topics IS NOT NULL
       ) x GROUP BY topic HAVING sum(wt) > 0 ORDER BY sum(wt) DESC LIMIT 8`,
      [userId],
    );
    return rows.map((r) => ({ id: r.topic as string, label: topicLabel(r.topic as string) }));
  }

  /** Como construí o meu algoritmo (valores por omissão se nunca mexi). */
  async feedSettings(userId: string): Promise<FeedSettings> {
    const { rows } = await this.pool.query('SELECT following, freshness, media, variety, hide_seen, calm FROM social.feed_settings WHERE user_id = $1', [userId]);
    const r = rows[0];
    return r ? { following: r.following, freshness: r.freshness, media: r.media, variety: r.variety, hideSeen: r.hide_seen, calm: r.calm } : { ...DEFAULT_FEED_SETTINGS };
  }

  async setFeedSettings(userId: string, patch: Partial<FeedSettings>) {
    const n = { ...(await this.feedSettings(userId)), ...patch };
    await this.pool.query(
      `INSERT INTO social.feed_settings (user_id, following, freshness, media, variety, hide_seen, calm) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET following = EXCLUDED.following, freshness = EXCLUDED.freshness, media = EXCLUDED.media, variety = EXCLUDED.variety, hide_seen = EXCLUDED.hide_seen, calm = EXCLUDED.calm, updated_at = now()`,
      [userId, n.following, n.freshness, n.media, n.variety, n.hideSeen, n.calm],
    );
    return n;
  }

  /** Contas que quero ver mais ou menos. */
  async explorePeople(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar, ep.pref
         FROM social.explore_people ep JOIN identity.users u ON u.id = ep.person_id WHERE ep.user_id = $1 AND u.status = 'active' ORDER BY ep.updated_at DESC`,
      [userId],
    );
    return rows.map((r) => ({ username: r.username as string, displayName: r.display_name as string, hasAvatar: r.has_avatar as boolean, pref: r.pref as number }));
  }

  async setPerson(userId: string, username: string, pref: -1 | 0 | 1) {
    const u = await this.pool.query(`SELECT id FROM identity.users WHERE lower(username) = lower($1) AND status = 'active'`, [username.replace(/^@/, '')]);
    if (!u.rows[0]) throw new NotFoundException('Essa pessoa não existe');
    const id = u.rows[0].id as string;
    if (id === userId) throw new BadRequestException('Não podes escolher-te a ti');
    if (pref === 0) await this.pool.query('DELETE FROM social.explore_people WHERE user_id = $1 AND person_id = $2', [userId, id]);
    else await this.pool.query('INSERT INTO social.explore_people (user_id, person_id, pref) VALUES ($1, $2, $3) ON CONFLICT (user_id, person_id) DO UPDATE SET pref = EXCLUDED.pref, updated_at = now()', [userId, id, pref]);
    return this.explorePeople(userId);
  }

  /** As minhas preferências por tema (1 = mais, -1 = menos). */
  async prefs(userId: string) {
    const { rows } = await this.pool.query('SELECT topic, pref FROM social.explore_prefs WHERE user_id = $1', [userId]);
    return Object.fromEntries(rows.map((r) => [r.topic as string, r.pref as number]));
  }

  async setPref(userId: string, topic: string, pref: -1 | 0 | 1) {
    if (!TOPIC_IDS.has(topic)) throw new BadRequestException('Tema desconhecido');
    if (pref === 0) await this.pool.query('DELETE FROM social.explore_prefs WHERE user_id = $1 AND topic = $2', [userId, topic]);
    else await this.pool.query('INSERT INTO social.explore_prefs (user_id, topic, pref) VALUES ($1, $2, $3) ON CONFLICT (user_id, topic) DO UPDATE SET pref = EXCLUDED.pref, updated_at = now()', [userId, topic, pref]);
    return this.prefs(userId);
  }

  /** Volta ao início: apaga as preferências e o "interessado / não interessado" (o histórico de brindes e comentários mantém-se). */
  async resetAlgorithm(userId: string) {
    await this.pool.query('DELETE FROM social.explore_prefs WHERE user_id = $1', [userId]);
    await this.pool.query('DELETE FROM social.feed_settings WHERE user_id = $1', [userId]);
    await this.pool.query('DELETE FROM social.explore_people WHERE user_id = $1', [userId]);
    await this.pool.query('DELETE FROM content.post_feedback WHERE user_id = $1', [userId]);
    await this.pool.query('UPDATE content.feed_impressions SET hidden = false WHERE user_id = $1 AND hidden', [userId]);
  }

  /** "Interessado" / "Não interessado" numa publicação: ensina o algoritmo. Não interessado também a esconde. */
  async setInterest(userId: string, postId: string, value: -1 | 1) {
    await this.assertPost(userId, postId);
    await this.pool.query('INSERT INTO content.post_feedback (user_id, post_id, value) VALUES ($1, $2, $3) ON CONFLICT (user_id, post_id) DO UPDATE SET value = EXCLUDED.value, created_at = now()', [userId, postId, value]);
    if (value < 0) await this.hideFromFeed(userId, postId);
    return { value };
  }

  /** Os temas para os chips do Explorar: os que têm publicações visíveis, com os teus interesses primeiro. */
  async exploreTopics(viewerId: string, all = false) {
    const { rows } = await this.pool.query(
      `WITH w AS (
         SELECT topic, sum(wt) AS wt FROM (
           SELECT unnest(p.topics) AS topic, 1.0 AS wt FROM content.cheers c JOIN content.posts p ON p.id = c.post_id WHERE c.user_id = $1 AND p.topics IS NOT NULL
           UNION ALL SELECT unnest(p.topics), 3.0 FROM content.saved_posts s JOIN content.posts p ON p.id = s.post_id WHERE s.user_id = $1 AND p.topics IS NOT NULL
         ) x GROUP BY topic),
       vis AS (
         SELECT unnest(p.topics) AS topic FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL
          WHERE p.kind = 'post' AND p.created_at > now() - interval '45 days' AND p.author_id <> $1 AND p.topics IS NOT NULL
            AND EXISTS (SELECT 1 FROM content.post_media pm WHERE pm.post_id = p.id) AND ${ADULT} AND ${canView()} AND ${inMyNetwork()})
       SELECT vis.topic, count(*)::int AS n, COALESCE(max(w.wt), 0) AS mine FROM vis LEFT JOIN w ON w.topic = vis.topic GROUP BY vis.topic
       ORDER BY COALESCE(max(w.wt), 0) DESC, count(*) DESC LIMIT ${all ? 80 : 14}`,
      [viewerId],
    );
    return rows.map((r) => ({ id: r.topic as string, label: topicLabel(r.topic as string), count: r.n as number }));
  }

  /** Uma publicação pelo código curto dos links (ou pelo id, nos links antigos). */
  async getByCode(userId: string, code: string) {
    if (!/^[A-Za-z0-9-]{6,36}$/.test(code)) throw new NotFoundException('Publicação não encontrada');
    const { rows } = await this.pool.query('SELECT id FROM content.posts WHERE short_code = $1 OR id::text = $1', [code]);
    if (!rows[0]) throw new NotFoundException('Publicação não encontrada');
    return this.getOne(userId, rows[0].id as string);
  }

  async getOne(userId: string, postId: string) {
    const { rows } = await this.pool.query(`${FEED_SQL} WHERE p.id = $2 AND ${canView()}`, [userId, postId]);
    const [post] = rows[0] ? await this.hydrate(userId, [rows[0]]) : [];
    if (!post) throw new NotFoundException('Publicação não encontrada');
    return post;
  }

  async toggleCheer(userId: string, postId: string) {
    await this.assertPost(userId, postId);
    const del = await this.pool.query('DELETE FROM content.cheers WHERE post_id = $1 AND user_id = $2', [postId, userId]);
    if (!del.rowCount) {
      const ins = await this.pool.query('INSERT INTO content.cheers (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, userId]);
      // Avisa quem publicou (agrupado por publicação; tirar o brinde não apaga o aviso). Ver NotificationsService.notifyCheer.
      if (ins.rowCount) {
        const p = (await this.pool.query(`SELECT p.author_id, ${tchekaPost()} AS tcheka FROM content.posts p WHERE p.id = $1`, [postId])).rows[0];
        if (p) await this.notifications.notifyCheer(p.author_id as string, userId, { kind: 'post', postId, tcheka: !!p.tcheka });
      }
    }
    const c = await this.pool.query('SELECT count(*)::int AS n FROM content.cheers WHERE post_id = $1', [postId]);
    return { cheered: !del.rowCount, cheers: c.rows[0].n };
  }

  /**
   * Presente numa publicação (Txills de demonstração). A pessoa escolhe como o dar:
   * `silent` (discreto, sem mensagem), `private` (mensagem só para o destinatário) ou `public` (post "X presenteou Y").
   * Mesmo depois de enviado pode publicar (ver `publishGift`).
   */
  async gift(userId: string, postId: string, amount: number, key: string, note = '', visibility: GiftVisibility = 'silent') {
    this.filter.assertClean(note);
    const { rows } = await this.pool.query(
      `SELECT p.author_id, ${allowedBy('u', 'gifts_allowed')} AS allowed,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS following
         FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL WHERE p.id = $2 AND ${canView()}`,
      [userId, postId],
    );
    if (!rows[0]) throw new NotFoundException('Publicação não encontrada');
    if (rows[0].author_id !== userId && !rows[0].following) throw new ForbiddenException('Só podes presentear quem segues 👀');
    if (!rows[0].allowed) throw new ForbiddenException('Esta pessoa não aceita presentes');
    const authorId: string = rows[0].author_id;
    if (authorId === userId) throw new UnprocessableEntityException('Não pode presentear a sua própria publicação');
    const r = await this.sendGift({ userId, toId: authorId, amount, key, note, visibility, postId });
    return {
      transactionId: r.transactionId,
      replayed: r.replayed,
      post: await this.getOne(userId, postId),
      announcement: r.announcementId ? await this.getOne(userId, r.announcementId) : null,
    };
  }

  /** Presente directo a uma pessoa, de onde quer que seja (perfil, carteira…). Mesmas escolhas de visibilidade. */
  async giftUser(userId: string, toUsername: string, amount: number, key: string, note = '', visibility: GiftVisibility = 'silent') {
    this.filter.assertClean(note);
    const to = await this.pool.query(
      `SELECT u.id, ${allowedBy('u', 'gifts_allowed')} AS allowed, ${blockedBetween('u.id', '$1')} AS blocked,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS following
         FROM identity.users u WHERE u.username = $2 AND u.status = 'active'`,
      [userId, toUsername],
    );
    if (!to.rows[0]) throw new NotFoundException('Utilizador não encontrado');
    if (to.rows[0].blocked) throw new ForbiddenException('Não podes presentear esta conta');
    if (to.rows[0].id !== userId && !to.rows[0].following) throw new ForbiddenException('Só podes presentear quem segues 👀');
    if (!to.rows[0].allowed) throw new ForbiddenException('Esta pessoa não aceita presentes');
    const r = await this.sendGift({ userId, toId: to.rows[0].id, amount, key, note, visibility });
    return { transactionId: r.transactionId, replayed: r.replayed, post: r.announcementId ? await this.getOne(userId, r.announcementId) : null };
  }

  /** Publicar DEPOIS: um presente já enviado pode ser anunciado no feed (só o remetente, uma única vez). */
  async publishGift(userId: string, transactionId: string, note?: string) {
    if (!/^[0-9a-f-]{36}$/.test(transactionId)) throw new BadRequestException('id inválido');
    const { rows } = await this.pool.query(
      `SELECT t.metadata, e.amount, a.user_id AS recipient_id
         FROM ledger.transactions t
         JOIN ledger.entries e ON e.transaction_id = t.id AND e.amount > 0
         JOIN ledger.accounts a ON a.id = e.account_id
        WHERE t.id = $1 AND t.actor_id = $2 AND t.type = 'gift'`,
      [transactionId, userId],
    );
    if (!rows[0]) throw new NotFoundException('Presente não encontrado');
    if ((await this.pool.query('SELECT 1 FROM content.posts WHERE gift_transaction_id = $1', [transactionId])).rowCount) {
      throw new ConflictException('Este presente já foi publicado');
    }
    const client = await this.pool.connect();
    try {
      const text = String(note ?? rows[0].metadata?.note ?? '').trim().slice(0, 280);
      const gifted = typeof rows[0].metadata?.postId === 'string' ? (rows[0].metadata.postId as string) : null;
      const id = await this.insertGiftPost(client, userId, rows[0].recipient_id, Number(rows[0].amount), transactionId, text, gifted);
      return { post: await this.getOne(userId, id) };
    } finally {
      client.release();
    }
  }

  /** Movimento no ledger + registos associados, numa só transacção; avisa o destinatário. */
  private async sendGift(p: { userId: string; toId: string; amount: number; key: string; note: string; visibility: GiftVisibility; postId?: string }) {
    await this.wallet.ensureWallet(p.userId);
    await this.wallet.ensureWallet(p.toId);
    // Discreto = sem mensagem. Privado/público levam a mensagem (privado: só o destinatário a vê).
    const note = p.visibility === 'silent' ? '' : p.note.trim().slice(0, 280);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await this.wallet.transfer(
        {
          actorId: p.userId, fromUserId: p.userId, toUserId: p.toId, amount: p.amount, type: 'gift', idempotencyKey: p.key,
          metadata: { ...(note ? { note } : {}), ...(p.postId ? { postId: p.postId } : {}) },
        },
        client,
      );
      if (p.postId && !r.replayed) {
        await client.query(
          'INSERT INTO content.gifts (id, post_id, sender_id, recipient_id, amount, transaction_id) VALUES ($1, $2, $3, $4, $5, $6)',
          [uuidv7(), p.postId, p.userId, p.toId, p.amount, r.transactionId],
        );
      }
      const announcementId = p.visibility === 'public' ? await this.insertGiftPost(client, p.userId, p.toId, p.amount, r.transactionId, note, p.postId ?? null) : null;
      await client.query('COMMIT');
      if (!r.replayed) {
        await this.notifications.notify({
          userId: p.toId, actorId: p.userId, kind: 'gift',
          data: { amount: p.amount, transactionId: r.transactionId, ...(note ? { note } : {}), ...(p.postId ? { postId: p.postId } : {}) },
        });
      }
      return { transactionId: r.transactionId, replayed: r.replayed, announcementId };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Cria (uma só vez por presente) o post "X presenteou Y". */
  private async insertGiftPost(client: PoolClient, userId: string, toId: string, amount: number, transactionId: string, note: string, giftedPostId: string | null = null) {
    const existing = await client.query('SELECT id FROM content.posts WHERE gift_transaction_id = $1', [transactionId]);
    if (existing.rows[0]) return existing.rows[0].id as string;
    const id = uuidv7();
    await client.query(
      `INSERT INTO content.posts (id, author_id, body, kind, gift_recipient_id, gift_amount, gift_transaction_id, repost_of)
       VALUES ($1, $2, $3, 'gift', $4, $5, $6, $7)`,
      [id, userId, note, toId, amount, transactionId, giftedPostId],
    );
    return id;
  }

  private async assertPost(viewerId: string, postId: string) {
    const r = await this.pool.query(
      `SELECT 1 FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL WHERE p.id = $2 AND ${canView()}`,
      [viewerId, postId],
    );
    if (!r.rowCount) throw new NotFoundException('Publicação não encontrada');
  }

  /**
   * Publicado como um local: quem vê só vê a página, nunca o gestor que publicou (só o próprio autor se vê).
   * Sem autor à vista, também não há presente nem botão de seguir a pessoa.
   */
  private toDto = (r: Record<string, any>) => {
    const d = this.toDtoRaw(r);
    if (!d.venue || r.by_viewer === true) return d;
    return {
      ...d,
      author: { id: '', username: '', displayName: d.venue.name, verified: d.venue.verified, verifiedTier: null },
      canGift: false,
      authorFollowed: true,
    };
  };

  /** O título de um som original guardado na música segue o @ atual do autor (o `sound` já vem com ele). */
  private withSoundTitle(music: Record<string, unknown> | null, sound: PostSound | null) {
    if (music?.kind === 'sound' && sound && sound.id === music.soundId) return { ...music, title: sound.title };
    return music;
  }

  /**
   * As tchekas que usam um som (a grelha de /som/:id), com as regras de sempre: só o que quem vê pode ver (privacidade,
   * bloqueios), da sua rede (como nas hashtags), sem as apagadas, as que escondeu e as que denunciou. `top`: as mais vistas
   * primeiro (vezes que apareceram no ecrã de alguém), depois as mais recentes, com a tcheka de onde o som saiu à frente;
   * `recent`: as mais recentes.
   */
  async bySound(viewerId: string, soundId: string, sort: 'top' | 'recent', cursor: string | undefined, limit: number) {
    const where = `p.sound_id = $2 AND p.kind = 'post' AND ${canView()} AND ${inMyNetwork()}
      AND NOT EXISTS (SELECT 1 FROM content.feed_impressions hi WHERE hi.user_id = $1 AND hi.post_id = p.id AND hi.hidden)
      AND NOT EXISTS (SELECT 1 FROM social.reports rr WHERE rr.reporter_id = $1 AND rr.target_type = 'post' AND rr.target_id = p.id)`;
    if (sort === 'recent') {
      if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new BadRequestException('cursor inválido');
      const { rows } = await this.pool.query(`${FEED_SQL} WHERE ${where} AND ($3::uuid IS NULL OR p.id < $3) ORDER BY p.id DESC LIMIT $4`, [viewerId, soundId, cursor ?? null, limit + 1]);
      const page = rows.slice(0, limit);
      return { items: await this.hydrate(viewerId, page), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
    }
    const offset = cursor && /^\d{1,5}$/.test(cursor) ? Number(cursor) : 0;
    const { rows: ids } = await this.pool.query(
      `SELECT p.id FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL
         LEFT JOIN content.sounds snd ON snd.id = p.sound_id
        WHERE ${where}
        ORDER BY (snd.source_post_id = p.id) DESC NULLS LAST, (SELECT count(*) FROM content.feed_impressions i WHERE i.post_id = p.id) DESC, p.id DESC
        OFFSET $3 LIMIT $4`,
      [viewerId, soundId, offset, limit + 1],
    );
    const page = ids.slice(0, limit).map((r) => r.id as string);
    if (!page.length) return { items: [], nextCursor: null };
    const { rows } = await this.pool.query(`${FEED_SQL} WHERE p.id = ANY($2)`, [viewerId, page]);
    const order = new Map(page.map((id, i) => [id, i]));
    rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return { items: await this.hydrate(viewerId, rows), nextCursor: ids.length > limit ? String(offset + limit) : null };
  }

  private toDtoRaw = (r: Record<string, any>) => ({
    id: r.id,
    /** Código curto para links limpos (txillapp.com/p/Ab3xK9q). */
    code: r.short_code as string,
    body: r.body,
    locationLabel: r.location_label,
    /** Faixa de licença aberta com o crédito do autor, se o post leva música. */
    // Um som original tirado pela equipa (ou de uma conta eliminada) deixa de tocar também nas tchekas que o usavam.
    music: r.music_ok === false ? null : this.musicSvc.resolve(this.withSoundTitle((r.music as Record<string, unknown> | null) ?? null, r.sound as PostSound | null)),
    /** O som da tcheka (docs/sons.md): abre /som/:id. Só quando o som existe para quem está a ver. */
    sound: (r.sound as PostSound | null) ?? null,
    media: (r.media as { id: string; video: boolean; durationMs: number | null; w: number | null; h: number | null; tags: PhotoTag[] }[]).map((m) => ({
      url: `/api/v1/media/${m.id}`,
      tags: m.tags,
      kind: (m.video ? 'video' : 'image') as 'video' | 'image',
      // Vídeos: capa, duração e proporção (para reservar o espaço antes de carregar).
      ...(m.video ? { posterUrl: `/api/v1/media/${m.id}?poster=1`, durationMs: m.durationMs, width: m.w, height: m.h } : {}),
    })),
    createdAt: r.created_at,
    author: { id: r.author_id, username: r.username, displayName: r.display_name, verified: r.author_verified as boolean, verifiedTier: (r.author_tier as string | null) ?? null },
    /** Publicada como um local (página): aparece com o nome e o logótipo da página. */
    venue: r.venue_slug ? { slug: r.venue_slug as string, name: r.venue_name as string, kind: r.venue_kind as string, verified: !!r.venue_verified, avatarUrl: r.venue_avatar ? `/api/v1/media/${r.venue_avatar as string}` : null } : null,
    cheers: r.cheers,
    comments: r.comments,
    gifts: r.gifts,
    cheered: r.cheered,
    /** Conforme as definições do autor: quem pode comentar e quem pode presentear. */
    canComment: r.can_comment,
    /** O autor desativou os comentários desta publicação. */
    commentsOff: r.comments_off as boolean,
    /** Guardada por quem está a ver (privado). */
    saved: !!r.saved,
    /** Posição (arredondada) do sítio, se foi escolhido da lista: serve para o mapa e para ver publicações perto. */
    locationGeo: r.location_lat != null ? { lat: r.location_lat as number, lng: r.location_lng as number } : null,
    editedAt: (r.edited_at as string | null) ?? null,
    /** Só se presenteia quem se segue (e que aceite presentes). `authorFollowed` explica ao ecrã porque não. */
    canGift: r.can_gift && r.author_followed,
    authorFollowed: r.author_followed as boolean,
    /** O dono deixa este espectador ver QUEM repostou / brindou / presenteou? (os números são sempre públicos) */
    lists: { reposts: r.reposts_list as boolean, cheers: r.cheers_list as boolean, gifts: r.gifts_list as boolean },
    kind: r.kind as 'post' | 'gift' | 'repost',
    reposts: r.reposts as number,
    reposted: r.reposted as boolean,
    gift:
      r.kind === 'gift'
        ? { amount: Number(r.gift_amount), recipient: { username: r.gift_username, displayName: r.gift_display_name, hasAvatar: r.gift_has_avatar === true, verified: r.gift_verified === true, verifiedTier: (r.gift_tier as string | null) ?? null } }
        : null,
  });
}


/** Do que a pessoa escolheu para os números que entram na classificação do Explorar e dos Reels. */
export function settingsToWeights(s: FeedSettings) {
  return {
    followedMul: { less: 0.8, balanced: 1.25, more: 2.2 }[s.following],
    decayHours: { recent: 36, balanced: 96, popular: 240 }[s.freshness],
    engagement: { recent: 4, balanced: 6, popular: 10 }[s.freshness],
    videoMul: { all: 1, photos: 0.6, videos: 1.8 }[s.media],
    photoMul: { all: 1, photos: 1.5, videos: 0.7 }[s.media],
    perAuthor: { low: 1, normal: 2, high: 4 }[s.variety],
  };
}

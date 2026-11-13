import { BadRequestException, ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { NotificationsService, type NotificationKind } from '../notifications/notifications.service';
import { tchekaPost } from '../posts/feed';
import { SearchIndexer } from '../search/search-index';
import { StaffService } from '../staff/staff.service';
import { REMOVABLE_TYPES, type RemovableType, removeContent, restoreContent } from './content-removal';
import { EVIDENCE_COLUMNS, REPORT_REASONS, REPORT_TYPES, type ReportReason, type ReportType, messageProof, releaseAppealedPhoto, removeReported, settleRejectedMedia } from './moderation.service';
import { ModuleRef } from '@nestjs/core';
import { TEXT_FILTER_PATTERN, TEXT_RULES, textHits } from './text-filter';

/** O peso de cada motivo na gravidade de uma queixa (0 a 100). */
export const REASON_WEIGHT: Record<ReportReason, number> = { minor: 100, violence: 85, hate: 75, nudity: 70, harassment: 55, scam: 50, impersonation: 40, spam: 20, other: 10 };
const WEIGHT_SQL = `max(CASE r.reason ${Object.entries(REASON_WEIGHT).map(([k, v]) => `WHEN '${k}' THEN ${v}`).join(' ')} ELSE 10 END)`;
/** Gravidade: o motivo mais grave, mais 3 pontos por cada pessoa a mais que denunciou (até +30). */
const SEVERITY_SQL = `(${WEIGHT_SQL} + least(count(*) - 1, 10) * 3)`;

/**
 * Página «Conteúdo»: fotos «assinaladas» a partir desta pontuação do classificador (só para a equipa procurar; não muda
 * nada para quem publica). Mais baixo do que NSFW_REVIEW_THRESHOLD, que decide o que vai sozinho para a fila.
 */
export const NSFW_FLAGGED = 0.5;

export const DESK_ACTIONS = ['dismiss', 'remove', 'warn', 'suspend'] as const;
export type DeskAction = (typeof DESK_ACTIONS)[number];
export const QUEUE_SORTS = ['severity', 'oldest', 'newest', 'reports'] as const;
export type QueueSort = (typeof QUEUE_SORTS)[number];

export interface QueueFilter { status: 'open' | 'actioned' | 'dismissed'; types?: ReportType[]; reason?: ReportReason; sort: QueueSort; q?: string }
export interface ContentFilter {
  type: 'all' | 'post' | 'tcheka' | 'story' | 'comment';
  q?: string; author?: string; tag?: string; from?: string; to?: string;
  state: 'visible' | 'removed' | 'all';
  flag?: 'nsfw' | 'text';
  cursor?: string;
}

interface MediaOut { id: string; video: boolean; nsfw: number | null; url: string; review?: boolean }
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const mediaUrl = (id: string, video: boolean) => (video ? `/api/v1/media/${id}?poster=1` : `/api/v1/media/${id}?w=640`);

/**
 * A mesa da moderação no backoffice: a fila de queixas com filtros, gravidade, contexto do autor e decisões em lote,
 * e a página «Conteúdo» (pesquisar, ver o que o modelo de fotos e o filtro de texto assinalaram, remover e repor com motivo).
 * Tudo o que se decide fica no registo de auditoria e o autor é avisado (notificação da equipa do Txillapp).
 */
@Injectable()
export class ModerationDeskService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly staff: StaffService,
    private readonly notifications: NotificationsService,
    private readonly indexer: SearchIndexer,
    private readonly moduleRef: ModuleRef,
  ) {}
  private readonly log = new Logger('Moderação');

  private audit(db: Pick<Pool, 'query'>, actor: string, action: string, target: string, metadata: Record<string, unknown>) {
    return db.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), actor, action, target, metadata]);
  }

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /* ───────────── contexto do autor ───────────── */

  /** Para cada autor: queixas (conteúdos denunciados), as que deram ação, avisos, remoções e suspensões anteriores. */
  async authorContext(ids: string[]) {
    const out = new Map<string, { reportedItems: number; actioned: number; openItems: number; warnings: number; removals: number; suspensions: number }>();
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return out;
    const { rows } = await this.pool.query(
      `SELECT u.id,
              (SELECT count(DISTINCT (x.target_type, x.target_id)) FROM social.reports x WHERE x.target_user_id = u.id)::int AS reported_items,
              (SELECT count(DISTINCT (x.target_type, x.target_id)) FROM social.reports x WHERE x.target_user_id = u.id AND x.status = 'actioned')::int AS actioned,
              (SELECT count(DISTINCT (x.target_type, x.target_id)) FROM social.reports x WHERE x.target_user_id = u.id AND x.status = 'open')::int AS open_items,
              (SELECT count(*) FROM audit.audit_log l WHERE l.action = 'moderation.warn' AND l.metadata->>'owner' = u.id::text)::int AS warnings,
              (SELECT count(*) FROM content.moderation_removals mr WHERE mr.author_id = u.id)::int AS removals,
              (SELECT count(*) FROM audit.audit_log l
                WHERE l.action IN ('backoffice.suspend', 'moderation.suspend') AND (l.target = 'user:' || u.id::text OR l.metadata->>'owner' = u.id::text))::int AS suspensions
         FROM identity.users u WHERE u.id = ANY($1::uuid[])`,
      [uniq],
    );
    for (const r of rows) out.set(r.id, { reportedItems: r.reported_items, actioned: r.actioned, openItems: r.open_items, warnings: r.warnings, removals: r.removals, suspensions: r.suspensions });
    return out;
  }

  /** As fotos e vídeos de publicações e mimos (para a pré-visualização), com a pontuação do modelo de fotos. */
  private async mediaOf(postIds: string[], storyIds: string[]) {
    const posts = new Map<string, MediaOut[]>();
    const stories = new Map<string, MediaOut[]>();
    if (postIds.length) {
      const { rows } = await this.pool.query(
        `SELECT pm.post_id, ma.id, ma.mime LIKE 'video/%' AS video, ma.nsfw_score FROM content.post_media pm JOIN content.media_assets ma ON ma.id = pm.media_id
          WHERE pm.post_id = ANY($1::uuid[]) AND ma.status = 'ready' ORDER BY pm.post_id, pm.position`,
        [[...new Set(postIds)]],
      );
      for (const r of rows) {
        const l = posts.get(r.post_id) ?? [];
        l.push({ id: r.id, video: r.video, nsfw: r.nsfw_score, url: mediaUrl(r.id, r.video) });
        posts.set(r.post_id, l);
      }
    }
    if (storyIds.length) {
      const { rows } = await this.pool.query(
        `SELECT s.id AS story_id, ma.id, ma.mime LIKE 'video/%' AS video, ma.nsfw_score FROM content.stories s JOIN content.media_assets ma ON ma.id = s.media_id
          WHERE s.id = ANY($1::uuid[]) AND ma.status = 'ready'`,
        [[...new Set(storyIds)]],
      );
      for (const r of rows) stories.set(r.story_id, [{ id: r.id, video: r.video, nsfw: r.nsfw_score, url: mediaUrl(r.id, r.video) }]);
    }
    return { posts, stories };
  }

  /* ───────────── fila de queixas ───────────── */

  async queue(f: QueueFilter) {
    const order = {
      severity: f.status === 'open' ? 'severity DESC, first_at ASC' : 'resolved_at DESC NULLS LAST',
      oldest: 'first_at ASC',
      newest: f.status === 'open' ? 'last_at DESC' : 'resolved_at DESC NULLS LAST',
      reports: 'reports DESC, first_at ASC',
    }[f.sort];
    const q = f.q?.trim().replace(/^@/, '');
    const { rows } = await this.pool.query(
      `SELECT r.target_type, r.target_id, r.target_user_id, count(*)::int AS reports, array_agg(DISTINCT r.reason) AS reasons,
              min(r.created_at) AS first_at, max(r.created_at) AS last_at, max(r.resolved_at) AS resolved_at,
              max(r.resolution) AS resolution, max(r.resolution_note) AS resolution_note, max(CASE WHEN rb.status = 'staff' THEN rb.display_name ELSE '@' || rb.username END) AS decided_by,
              bool_or(r.reporter_id IS NULL) AS automatic, ${SEVERITY_SQL}::int AS severity,
              tu.username AS owner_username, tu.display_name AS owner_name, tu.status AS owner_status,
              COALESCE(p.body, c.body, s.caption, max(m.body), max(sc.body), NULLIF(max(ins.caption), ''),
                       CASE WHEN r.target_type = 'media' THEN max(r.note) END,
                       CASE WHEN r.target_type = 'venue' THEN max(v.name) || coalesce(' · ' || max(v.about), '') END,
                       CASE WHEN r.target_type = 'user' THEN max(tu.display_name) END, '') AS preview,
              p.removed_at AS post_removed_at, p.removed_by AS post_removed_by, c.post_id AS comment_post_id,
              s.expires_at AS story_expires_at, max(v.slug) AS venue_slug,
              bool_or(sc.id IS NOT NULL) AS story_comment_exists, max(ins.expires_at) AS instant_expires_at, max(ins.media_id::text) AS instant_media_id,
              (SELECT ima.nsfw_score FROM content.media_assets ima WHERE ima.id = max(ins.media_id::text)::uuid) AS instant_nsfw,
              (SELECT mr.removed_at FROM content.moderation_removals mr WHERE mr.target_type = r.target_type AND mr.target_id = r.target_id AND mr.restored_at IS NULL) AS mod_removed_at,
              (SELECT ma.nsfw_score FROM content.media_assets ma WHERE r.target_type = 'media' AND ma.id = r.target_id) AS media_nsfw,
              (SELECT ma.appealed_at IS NOT NULL AND ma.status = 'rejected' FROM content.media_assets ma WHERE r.target_type = 'media' AND ma.id = r.target_id) AS media_appeal,
              ${EVIDENCE_COLUMNS}
         FROM social.reports r
         LEFT JOIN identity.users tu ON tu.id = r.target_user_id
         LEFT JOIN identity.users rb ON rb.id = r.resolved_by
         LEFT JOIN content.posts p ON r.target_type = 'post' AND p.id = r.target_id
         LEFT JOIN content.comments c ON r.target_type = 'comment' AND c.id = r.target_id
         LEFT JOIN content.stories s ON r.target_type = 'story' AND s.id = r.target_id
         LEFT JOIN social.messages m ON r.target_type = 'message' AND m.id = r.target_id
         LEFT JOIN content.venues v ON r.target_type = 'venue' AND v.id = r.target_id
         LEFT JOIN content.story_comments sc ON r.target_type = 'story_comment' AND sc.id = r.target_id
         LEFT JOIN social.instants ins ON r.target_type = 'instant' AND ins.id = r.target_id
        WHERE r.status = $1 AND ($2::text[] IS NULL OR r.target_type = ANY($2::text[]))
          AND ($4::text IS NULL OR tu.username ILIKE $4 ESCAPE '\\' OR tu.display_name ILIKE $4 ESCAPE '\\')
        GROUP BY r.target_type, r.target_id, r.target_user_id, tu.username, tu.display_name, tu.status, p.body, c.body, s.caption,
                 p.removed_at, p.removed_by, c.post_id, s.expires_at
       HAVING ($3::text IS NULL OR $3 = ANY(array_agg(r.reason)))
        ORDER BY ${order} LIMIT 200`,
      [f.status, f.types?.length ? f.types : null, f.reason ?? null, q ? like(q) : null],
    );
    const ctx = await this.authorContext(rows.map((r) => r.target_user_id));
    const media = await this.mediaOf(rows.filter((r) => r.target_type === 'post').map((r) => r.target_id), rows.filter((r) => r.target_type === 'story').map((r) => r.target_id));
    const counts = await this.pool.query(
      `SELECT target_type, count(DISTINCT target_id)::int AS n FROM social.reports WHERE status = 'open' GROUP BY target_type`,
    );
    return {
      counts: Object.fromEntries(counts.rows.map((r) => [r.target_type, r.n])) as Record<string, number>,
      items: rows.map((r) => this.queueItem(r, ctx, media)),
    };
  }

  private queueItem(r: Record<string, any>, ctx: Awaited<ReturnType<ModerationDeskService['authorContext']>>, media: Awaited<ReturnType<ModerationDeskService['mediaOf']>>) {
    const type = r.target_type as ReportType;
    const proof = messageProof(r);
    const items: MediaOut[] =
      type === 'post' ? media.posts.get(r.target_id) ?? []
      : type === 'story' ? media.stories.get(r.target_id) ?? []
      : type === 'media' ? [{ id: r.target_id, video: false, nsfw: r.media_nsfw ?? null, url: `/api/v1/media/review/${r.target_id}`, review: true }]
      // A foto de um Zás é privada (só amigos ou próximos): vê-se pela rota de revisão, com registo, enquanto a queixa está aberta.
      : type === 'instant' && r.instant_media_id ? [{ id: r.instant_media_id as string, video: false, nsfw: r.instant_nsfw ?? null, url: `/api/v1/media/review/${r.instant_media_id}`, review: true }]
      : [];
    const removed =
      type === 'post' ? (r.post_removed_at ? (r.post_removed_by === 'moderation' ? 'moderation' : 'author') : null)
      : type === 'story' ? (r.mod_removed_at ? 'moderation' : r.story_expires_at && new Date(r.story_expires_at) < new Date() ? 'expired' : r.story_expires_at ? null : 'gone')
      : type === 'comment' ? (r.mod_removed_at ? 'moderation' : r.comment_post_id ? null : 'gone')
      : type === 'message' ? (proof.current?.deleted ? 'gone' : null)
      // Comentário de mimo: a moderação apaga-o; Zás: a moderação fá-lo expirar já (0125).
      : type === 'story_comment' ? (r.story_comment_exists ? null : r.resolution === 'remove' ? 'moderation' : 'gone')
      : type === 'instant' ? (!r.instant_expires_at ? 'gone' : new Date(r.instant_expires_at) <= new Date() ? (r.resolution === 'remove' ? 'moderation' : 'expired') : null)
      : null;
    return {
      type,
      id: r.target_id as string,
      reports: r.reports as number,
      reasons: r.reasons as ReportReason[],
      severity: r.severity as number,
      automatic: !!r.automatic,
      /** Foto recusada pela verificação automática, com pedido de revisão do dono: dispensar aprova-a; remover apaga-a. */
      appeal: !!r.media_appeal,
      firstAt: r.first_at as string,
      lastAt: r.last_at as string,
      resolvedAt: (r.resolved_at as string | null) ?? null,
      resolution: (r.resolution as string | null) ?? null,
      resolutionNote: (r.resolution_note as string | null) ?? null,
      decidedBy: (r.decided_by as string | null) ?? null,
      owner: r.target_user_id
        ? { id: r.target_user_id as string, username: r.owner_username as string, displayName: r.owner_name as string, status: r.owner_status as string, ...(ctx.get(r.target_user_id) ?? {}) }
        : null,
      preview: String(proof.reported ? proof.reported.body : r.preview ?? '').slice(0, 600),
      media: items,
      nsfw: items.reduce<number | null>((m, x) => (x.nsfw != null && (m == null || x.nsfw > m) ? x.nsfw : m), null),
      textHits: textHits(proof.reported ? proof.reported.body : r.preview),
      postId: type === 'post' ? (r.target_id as string) : type === 'comment' ? ((r.comment_post_id as string | null) ?? null) : null,
      venueSlug: (r.venue_slug as string | null) ?? null,
      removed,
      reported: proof.reported,
      current: proof.current,
    };
  }

  /** Uma queixa em detalhe: cada denúncia (quem, porquê, nota), e o histórico do autor (decisões e suspensões). */
  async queueItemDetail(type: ReportType, id: string) {
    const reports = (
      await this.pool.query(
        `SELECT r.id, r.reason, r.note, r.status, r.resolution, r.resolution_note, r.created_at, r.resolved_at, r.target_user_id,
                ru.username AS reporter, CASE WHEN ad.status = 'staff' THEN ad.display_name ELSE '@' || ad.username END AS decided_by
           FROM social.reports r LEFT JOIN identity.users ru ON ru.id = r.reporter_id LEFT JOIN identity.users ad ON ad.id = r.resolved_by
          WHERE r.target_type = $1 AND r.target_id = $2 ORDER BY r.created_at`,
        [type, id],
      )
    ).rows;
    if (!reports.length) throw new NotFoundException('Sem denúncias para este conteúdo');
    const owner = (reports[0].target_user_id as string | null) ?? null;
    let history: unknown[] = [];
    let past: unknown[] = [];
    if (owner) {
      history = (
        await this.pool.query(
          `SELECT l.action, l.target, l.metadata, l.created_at, CASE WHEN a.status = 'staff' THEN a.display_name ELSE '@' || a.username END AS actor FROM audit.audit_log l LEFT JOIN identity.users a ON a.id = l.actor_id
            WHERE l.action IN ('backoffice.suspend', 'backoffice.reactivate', 'moderation.suspend', 'moderation.warn', 'moderation.remove', 'moderation.content_remove', 'moderation.content_restore')
              AND (l.target = 'user:' || $1::text OR l.metadata->>'owner' = $1::text)
            ORDER BY l.id DESC LIMIT 30`,
          [owner],
        )
      ).rows.map((r) => ({ action: r.action, target: r.target, reason: r.metadata?.note ?? r.metadata?.reason ?? null, at: r.created_at, actor: r.actor }));
      past = (
        await this.pool.query(
          `SELECT r.target_type AS type, r.target_id AS id, count(*)::int AS reports, array_agg(DISTINCT r.reason) AS reasons, max(r.status) AS status,
                  max(r.resolution) AS resolution, max(r.created_at) AS at
             FROM social.reports r WHERE r.target_user_id = $1 AND NOT (r.target_type = $2 AND r.target_id = $3)
            GROUP BY r.target_type, r.target_id ORDER BY max(r.created_at) DESC LIMIT 20`,
          [owner, type, id],
        )
      ).rows;
    }
    return {
      reports: reports.map((r) => ({ id: r.id, reason: r.reason, note: r.note, status: r.status, resolution: r.resolution, resolutionNote: r.resolution_note, at: r.created_at, resolvedAt: r.resolved_at, reporter: r.reporter ?? null, decidedBy: r.decided_by ?? null })),
      history,
      past,
    };
  }

  /**
   * Decide uma ou várias queixas (até 50) com a mesma ação e o mesmo motivo. Cada uma é uma transação: as que falham não
   * travam as outras e vêm na resposta. Suspender exige também a permissão de suspender contas.
   */
  async decide(actor: string, items: { type: ReportType; id: string }[], action: DeskAction, note: string | undefined, notify: boolean) {
    const reason = note?.trim() || undefined;
    if (action !== 'dismiss' && (!reason || reason.length < 3)) throw new BadRequestException('Escreve o motivo');
    if (action === 'suspend' && !(await this.staff.permissions(actor)).has('users.suspend')) throw new ForbiddenException('A tua equipa não pode suspender contas');
    const seen = new Set<string>();
    const list = items.filter((i) => !seen.has(`${i.type}:${i.id}`) && seen.add(`${i.type}:${i.id}`));
    const done: { type: string; id: string }[] = [];
    const failed: { type: string; id: string; error: string }[] = [];
    const after: (() => void)[] = [];
    const suspended = new Set<string>();
    for (const it of list) {
      try {
        await this.tx(async (c) => {
          const open = (await c.query(`SELECT target_user_id FROM social.reports WHERE target_type = $1 AND target_id = $2 AND status = 'open' LIMIT 1 FOR UPDATE`, [it.type, it.id])).rows[0];
          if (!open) throw new NotFoundException('Já não há denúncias por decidir neste conteúdo');
          const owner = (open.target_user_id as string | null) ?? null;
          let tcheka = false;
          if (it.type === 'post') tcheka = !!(await c.query(`SELECT ${tchekaPost()} AS t FROM content.posts p WHERE p.id = $1`, [it.id])).rows[0]?.t;
          const postId = it.type === 'post' ? it.id : it.type === 'comment' ? ((await c.query('SELECT post_id FROM content.comments WHERE id = $1', [it.id])).rows[0]?.post_id ?? null) : null;
          if (action === 'remove') await removeReported(c, it.type, it.id, actor, reason);
          const approved = await settleRejectedMedia(c, it.type, it.id, action);
          if (action === 'warn' && !owner) throw new BadRequestException('Não se sabe de quem é este conteúdo');
          if (action === 'suspend') {
            if (!owner) throw new BadRequestException('Conta desconhecida');
            const t = (await c.query('SELECT is_admin, status FROM identity.users WHERE id = $1', [owner])).rows[0];
            if (t?.is_admin || t?.status === 'staff') throw new ForbiddenException('Não se suspende uma conta de moderação');
            if (!suspended.has(owner)) {
              await c.query(`UPDATE identity.users SET status = 'suspended' WHERE id = $1 AND status = 'active'`, [owner]);
              await c.query('UPDATE identity.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [owner]);
            }
          }
          await c.query(
            `UPDATE social.reports SET status = $3, resolution = $4, resolved_by = $5, resolved_at = now(), resolution_note = $6
              WHERE target_type = $1 AND target_id = $2 AND status = 'open'`,
            [it.type, it.id, action === 'dismiss' ? 'dismissed' : 'actioned', action, actor, reason ?? null],
          );
          await this.audit(c, actor, `moderation.${action}`, `${it.type}:${it.id}`, { owner, note: reason, via: 'queue', ...(list.length > 1 ? { batch: list.length } : {}), ...(action === 'remove' || action === 'warn' ? { notified: notify } : {}) });
          after.push(() => {
            if (action === 'remove' && it.type === 'post') this.indexer.postRemoved(it.id);
            if (action === 'suspend' && owner && !suspended.has(owner)) this.indexer.userRemoved(owner);
            if (action === 'suspend' && owner) suspended.add(owner);
            // Foto recusada aprovada no pedido de revisão: volta ao sítio e o dono é sempre avisado.
            if (approved) void releaseAppealedPhoto(this.moduleRef, this.notifications, it.id, owner, actor, this.log);
            const kind: NotificationKind | null = action === 'remove' ? 'content_removed' : action === 'warn' ? 'moderation_warning' : null;
            if (kind && notify && owner) void this.notifications.notify({ userId: owner, actorId: actor, kind, data: { type: it.type, reason, ...(postId ? { postId } : {}), ...(tcheka ? { tcheka: true } : {}) } });
          });
        });
        after.splice(0).forEach((f) => f());
        done.push(it);
      } catch (e) {
        after.splice(0);
        failed.push({ ...it, error: e instanceof HttpException ? e.message : 'Erro inesperado' });
        if (!(e instanceof HttpException)) throw e;
      }
    }
    if (list.length > 1) await this.audit(this.pool, actor, 'moderation.batch', `reports:${action}`, { action, note: reason, count: list.length, done: done.length, failed: failed.length });
    return { done, failed };
  }

  /* ───────────── página «Conteúdo» ───────────── */

  async content(f: ContentFilter, limit = 30) {
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const qText = f.q?.trim() ? p(like(f.q.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase())) : null;
    let authorId: string | null = null;
    if (f.author?.trim()) {
      authorId = (await this.pool.query('SELECT id FROM identity.users WHERE lower(username) = lower($1)', [f.author.trim().replace(/^@/, '')])).rows[0]?.id ?? null;
      if (!authorId) return { items: [], nextCursor: null, rules: TEXT_RULES.map((r) => ({ id: r.id, label: r.label })), nsfwThreshold: NSFW_FLAGGED };
    }
    const author = authorId ? p(authorId) : null;
    const tag = f.tag?.trim() ? f.tag.trim().replace(/^#/, '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9_]/g, '') : '';
    const tagP = tag ? p(tag) : null;
    const tagRe = tag ? p(`#${tag}([^a-z0-9_]|$)`) : null;
    const from = f.from ? p(f.from) : null;
    const to = f.to ? p(f.to) : null;
    const cursor = f.cursor ? p(f.cursor) : null;
    const nsfw = f.flag === 'nsfw' ? p(NSFW_FLAGGED) : null;
    const textRe = f.flag === 'text' ? p(TEXT_FILTER_PATTERN) : null;
    const lim = p(limit + 1);

    const folded = (col: string) => `lower(content.f_unaccent(coalesce(${col}, '')))`;
    const common = (body: string, created: string, authorCol: string) => [
      qText ? `${folded(body)} LIKE ${qText} ESCAPE '\\'` : null,
      author ? `${authorCol} = ${author}` : null,
      from ? `${created} >= ${from}::timestamptz` : null,
      to ? `${created} < ${to}::timestamptz + interval '1 day'` : null,
      cursor ? `${created} < ${cursor}::timestamptz` : null,
      textRe ? `${folded(body)} ~ ${textRe}` : null,
    ].filter(Boolean) as string[];
    const where = (l: (string | null)[]) => { const x = l.filter(Boolean); return x.length ? `WHERE ${x.join(' AND ')}` : ''; };

    const parts: string[] = [];
    if (f.type === 'all' || f.type === 'post' || f.type === 'tcheka') {
      const maxNsfw = `(SELECT max(ma.nsfw_score) FROM content.post_media pm JOIN content.media_assets ma ON ma.id = pm.media_id WHERE pm.post_id = p.id)`;
      parts.push(`SELECT 'post'::text AS type, p.id, p.author_id, p.body, p.created_at, p.removed_at, p.removed_by, NULL::uuid AS post_id, ${maxNsfw} AS nsfw,
                         ${tchekaPost()} AS tcheka, NULL::timestamptz AS expires_at, p.kind
                    FROM content.posts p
                    ${where([
                      ...common('p.body', 'p.created_at', 'p.author_id'),
                      f.state === 'visible' ? 'p.removed_at IS NULL' : f.state === 'removed' ? `p.removed_by = 'moderation'` : null,
                      f.type === 'tcheka' ? tchekaPost() : null,
                      tagP ? `EXISTS (SELECT 1 FROM content.post_tags t WHERE t.post_id = p.id AND t.tag = ${tagP})` : null,
                      nsfw ? `${maxNsfw} >= ${nsfw}` : null,
                    ])}`);
    }
    if (f.type === 'all' || f.type === 'story') {
      const rm = `(SELECT mr.removed_at FROM content.moderation_removals mr WHERE mr.target_type = 'story' AND mr.target_id = s.id AND mr.restored_at IS NULL)`;
      parts.push(`SELECT 'story'::text AS type, s.id, s.author_id, coalesce(s.caption, '') AS body, s.created_at, ${rm} AS removed_at, CASE WHEN ${rm} IS NOT NULL THEN 'moderation' END AS removed_by,
                         NULL::uuid AS post_id, ma.nsfw_score AS nsfw, false AS tcheka, s.expires_at, NULL::text AS kind
                    FROM content.stories s LEFT JOIN content.media_assets ma ON ma.id = s.media_id
                    ${where([
                      ...common('s.caption', 's.created_at', 's.author_id'),
                      f.state === 'visible' ? `${rm} IS NULL` : f.state === 'removed' ? `${rm} IS NOT NULL` : null,
                      tagRe ? `${folded('s.caption')} ~ ${tagRe}` : null,
                      nsfw ? `ma.nsfw_score >= ${nsfw}` : null,
                    ])}`);
    }
    if ((f.type === 'all' || f.type === 'comment') && !nsfw) {
      if (f.state !== 'removed') {
        parts.push(`SELECT 'comment'::text AS type, c.id, c.author_id, c.body, c.created_at, NULL::timestamptz AS removed_at, NULL::text AS removed_by, c.post_id,
                             NULL::real AS nsfw, false AS tcheka, NULL::timestamptz AS expires_at, NULL::text AS kind
                      FROM content.comments c
                      ${where([...common('c.body', 'c.created_at', 'c.author_id'), tagRe ? `${folded('c.body')} ~ ${tagRe}` : null])}`);
      }
      if (f.state !== 'visible') {
        const created = `coalesce((mr.snapshot->'rows'->0->>'created_at')::timestamptz, mr.removed_at)`;
        parts.push(`SELECT 'comment'::text AS type, mr.target_id AS id, mr.author_id, coalesce(mr.body, '') AS body, ${created} AS created_at, mr.removed_at, 'moderation'::text AS removed_by,
                             mr.post_id, NULL::real AS nsfw, false AS tcheka, NULL::timestamptz AS expires_at, NULL::text AS kind
                      FROM content.moderation_removals mr
                      ${where([`mr.target_type = 'comment'`, 'mr.restored_at IS NULL', ...common('mr.body', created, 'mr.author_id'), tagRe ? `${folded('mr.body')} ~ ${tagRe}` : null])}`);
      }
    }
    if (!parts.length) return { items: [], nextCursor: null, rules: TEXT_RULES.map((r) => ({ id: r.id, label: r.label })), nsfwThreshold: NSFW_FLAGGED };
    const { rows } = await this.pool.query(`SELECT * FROM (${parts.join('\n UNION ALL \n')}) x ORDER BY created_at DESC, id DESC LIMIT ${lim}`, params);
    const page = rows.slice(0, limit);

    const authors = new Map<string, { username: string; displayName: string; status: string }>();
    const aIds = [...new Set(page.map((r) => r.author_id).filter(Boolean))];
    if (aIds.length) {
      for (const r of (await this.pool.query('SELECT id, username, display_name, status FROM identity.users WHERE id = ANY($1::uuid[])', [aIds])).rows) {
        authors.set(r.id, { username: r.username, displayName: r.display_name, status: r.status });
      }
    }
    const ctx = await this.authorContext(aIds);
    const media = await this.mediaOf(page.filter((r) => r.type === 'post').map((r) => r.id), page.filter((r) => r.type === 'story').map((r) => r.id));
    const keys = page.map((r) => `${r.type}:${r.id}`);
    const reports = new Map<string, number>();
    const removals = new Map<string, { reason: string; at: string; by: string | null }>();
    if (keys.length) {
      for (const r of (await this.pool.query(
        `SELECT target_type || ':' || target_id AS k, count(*)::int AS n FROM social.reports WHERE status = 'open' AND target_type || ':' || target_id = ANY($1::text[]) GROUP BY 1`,
        [keys],
      )).rows) reports.set(r.k, r.n);
      for (const r of (await this.pool.query(
        `SELECT mr.target_type || ':' || mr.target_id AS k, mr.reason, mr.removed_at, CASE WHEN u.status = 'staff' THEN u.display_name ELSE '@' || u.username END AS username FROM content.moderation_removals mr LEFT JOIN identity.users u ON u.id = mr.removed_by
          WHERE mr.restored_at IS NULL AND mr.target_type || ':' || mr.target_id = ANY($1::text[])`,
        [keys],
      )).rows) removals.set(r.k, { reason: r.reason, at: r.removed_at, by: r.username ?? null });
    }
    const threshold = NSFW_FLAGGED;
    return {
      items: page.map((r) => {
        const k = `${r.type}:${r.id}`;
        const a = authors.get(r.author_id);
        const items = r.type === 'post' ? media.posts.get(r.id) ?? [] : r.type === 'story' ? media.stories.get(r.id) ?? [] : [];
        return {
          type: r.type as RemovableType,
          id: r.id as string,
          tcheka: !!r.tcheka,
          gift: r.kind === 'gift',
          body: String(r.body ?? ''),
          createdAt: r.created_at as string,
          postId: r.type === 'post' ? r.id : (r.post_id as string | null) ?? null,
          author: a ? { id: r.author_id as string, ...a, ...(ctx.get(r.author_id) ?? {}) } : null,
          media: items,
          nsfw: (r.nsfw as number | null) ?? null,
          nsfwFlagged: r.nsfw != null && r.nsfw >= threshold,
          textHits: textHits(r.body),
          openReports: reports.get(k) ?? 0,
          state: r.removed_by === 'moderation' ? 'removed' : r.removed_by === 'author' || r.removed_by === 'original' ? 'deleted' : r.type === 'story' && r.expires_at && new Date(r.expires_at) <= new Date() ? 'expired' : 'visible',
          removal: removals.get(k) ?? null,
        };
      }),
      nextCursor: rows.length > limit ? new Date(page[page.length - 1].created_at).toISOString() : null,
      rules: TEXT_RULES.map((r) => ({ id: r.id, label: r.label })),
      nsfwThreshold: threshold,
    };
  }

  /** Remover um conteúdo pela página «Conteúdo»: fecha também as denúncias abertas dele, regista e avisa o autor. */
  async removeOne(actor: string, type: RemovableType, id: string, reason: string, notify: boolean) {
    const tcheka = type === 'post' ? !!(await this.pool.query(`SELECT ${tchekaPost()} AS t FROM content.posts p WHERE p.id = $1`, [id])).rows[0]?.t : false;
    const r = await this.tx(async (c) => {
      const out = await removeContent(c, type, id, actor, reason);
      const closed = await c.query(
        `UPDATE social.reports SET status = 'actioned', resolution = 'remove', resolved_by = $3, resolved_at = now(), resolution_note = $4
          WHERE target_type = $1 AND target_id = $2 AND status = 'open'`,
        [type, id, actor, reason],
      );
      await this.audit(c, actor, 'moderation.content_remove', `${type}:${id}`, { owner: out.authorId, reason, notified: notify, reportsClosed: closed.rowCount ?? 0 });
      return out;
    });
    if (type === 'post') this.indexer.postRemoved(id);
    if (notify && r.authorId) void this.notifications.notify({ userId: r.authorId, actorId: actor, kind: 'content_removed', data: { type, reason, ...(r.postId ? { postId: r.postId } : {}), ...(tcheka ? { tcheka: true } : {}) } });
    return { ok: true };
  }

  async restoreOne(actor: string, type: RemovableType, id: string, reason: string, notify: boolean) {
    const r = await this.tx(async (c) => {
      const out = await restoreContent(c, type, id, actor, reason);
      await this.audit(c, actor, 'moderation.content_restore', `${type}:${id}`, { owner: out.authorId, reason, notified: notify, expired: out.expired || undefined });
      return out;
    });
    if (type === 'post') this.indexer.postChanged(id);
    if (notify && r.authorId) void this.notifications.notify({ userId: r.authorId, actorId: actor, kind: 'content_restored', data: { type, reason, ...(r.postId ? { postId: r.postId } : {}) } });
    return { ok: true, expired: r.expired };
  }
}

export { REMOVABLE_TYPES, REPORT_REASONS, REPORT_TYPES };

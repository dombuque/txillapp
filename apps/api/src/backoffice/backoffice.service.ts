import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { SearchIndexer } from '../search/search-index';
import { EVIDENCE_COLUMNS, messageProof } from '../moderation/moderation.service';

/** Backoffice: ver e agir sobre contas, queixas decididas e o registo de auditoria. Só para contas de moderação. */
@Injectable()
export class BackofficeService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly indexer: SearchIndexer,
  ) {}

  /** Resumo do dia: o que precisa de atenção. */
  async overview() {
    const r = (
      await this.pool.query(
        `SELECT (SELECT count(DISTINCT (target_type, target_id)) FROM social.reports WHERE status = 'open')::int AS reports_open,
                (SELECT count(*) FROM identity.verification_requests WHERE status = 'pending')::int AS verifications_pending,
                (SELECT count(*) FROM identity.users WHERE status = 'active' AND created_at > now() - interval '24 hours')::int AS new_24h,
                (SELECT count(*) FROM identity.users WHERE status = 'active' AND created_at > now() - interval '7 days')::int AS new_7d,
                (SELECT count(*) FROM identity.users WHERE status = 'active')::int AS active_total,
                (SELECT count(*) FROM identity.users WHERE status = 'suspended')::int AS suspended,
                (SELECT count(*) FROM identity.users WHERE status = 'active' AND email_verified_at IS NULL AND created_at < now() - interval '1 day')::int AS unverified_old,
                (SELECT count(*) FROM social.referrals WHERE status = 'blocked')::int AS invites_blocked`,
      )
    ).rows[0];
    return r as Record<string, number>;
  }

  /** Pesquisa de contas por @, nome ou email. */
  async users(q: string | undefined, status: string | undefined, cursor: string | undefined, limit = 30) {
    const term = (q ?? '').trim().replace(/^@/, '');
    const like = term ? `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const { rows } = await this.pool.query(
      `SELECT u.id, u.username, u.display_name, u.email, u.status, u.is_admin, u.created_at, u.country,
              u.email_verified_at IS NOT NULL AS verified,
              (SELECT count(*) FROM content.posts p WHERE p.author_id = u.id AND p.removed_at IS NULL)::int AS posts,
              (SELECT count(*) FROM social.follows f WHERE f.followee_id = u.id)::int AS followers,
              (SELECT count(*) FROM social.reports r WHERE r.target_user_id = u.id)::int AS reports,
              (SELECT max(s.created_at) FROM identity.sessions s WHERE s.user_id = u.id) AS last_seen
         FROM identity.users u
        WHERE ($1::text IS NULL OR u.username ILIKE $1 ESCAPE '\\' OR u.display_name ILIKE $1 ESCAPE '\\' OR u.email ILIKE $1 ESCAPE '\\')
          AND u.status <> 'staff'
          AND ($2::text IS NULL OR u.status = $2)
          AND ($3::uuid IS NULL OR u.id < $3)
        ORDER BY u.id DESC LIMIT $4`,
      [like, status && ['active', 'suspended', 'deleted'].includes(status) ? status : null, cursor ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return { items: page, nextCursor: rows.length > limit ? (page[page.length - 1].id as string) : null };
  }

  /** A ficha de uma conta: dados, números, denúncias, convites, notas e o que a equipa já fez nela. */
  async user(id: string) {
    const u = (
      await this.pool.query(
        `SELECT u.id, u.username, u.display_name, u.email, u.status, u.is_admin, u.is_private, u.created_at, u.country, u.terms_version,
                u.email_verified_at, u.avatar_media_id IS NOT NULL AS has_avatar,
                (SELECT count(*) FROM content.posts p WHERE p.author_id = u.id AND p.removed_at IS NULL)::int AS posts,
                (SELECT count(*) FROM social.follows f WHERE f.followee_id = u.id)::int AS followers,
                (SELECT count(*) FROM social.follows f WHERE f.follower_id = u.id)::int AS following,
                (SELECT count(*) FROM social.messages m WHERE m.sender_id = u.id)::int AS messages,
                (SELECT count(*) FROM identity.sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now())::int AS sessions,
                (SELECT max(s.created_at) FROM identity.sessions s WHERE s.user_id = u.id) AS last_seen,
                coalesce((SELECT balance FROM ledger.accounts a WHERE a.user_id = u.id), 0)::bigint AS txills
           FROM identity.users u WHERE u.id = $1`,
        [id],
      )
    ).rows[0];
    if (!u) throw new NotFoundException('Conta não encontrada');
    const reportsAgainst = (
      await this.pool.query(
        `SELECT r.target_type, r.target_id, r.reason, r.status, r.resolution, r.resolution_note, r.created_at, ru.username AS reporter,
                r.evidence -- numa mensagem: a cópia guardada no momento da denúncia (0111)
           FROM social.reports r LEFT JOIN identity.users ru ON ru.id = r.reporter_id
          WHERE r.target_user_id = $1 ORDER BY r.created_at DESC LIMIT 20`,
        [id],
      )
    ).rows;
    const invite = (
      await this.pool.query(
        `SELECT (SELECT count(*) FROM social.referrals WHERE inviter_id = $1)::int AS invited,
                (SELECT count(*) FROM social.referrals WHERE inviter_id = $1 AND status = 'paid')::int AS paid,
                (SELECT row_to_json(x) FROM (SELECT r.status, r.reason, iu.username AS inviter FROM social.referrals r JOIN identity.users iu ON iu.id = r.inviter_id WHERE r.invitee_id = $1) x) AS came_from`,
        [id],
      )
    ).rows[0];
    const notes = (
      await this.pool.query(
        `SELECT n.id, n.body, n.created_at, a.username AS author FROM audit.staff_notes n LEFT JOIN identity.users a ON a.id = n.author_id WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 30`,
        [id],
      )
    ).rows;
    const history = (
      await this.pool.query(
        `SELECT l.action, l.metadata, l.created_at, a.username AS actor FROM audit.audit_log l LEFT JOIN identity.users a ON a.id = l.actor_id
          WHERE l.target = 'user:' || $1::text OR (l.actor_id = $1::text::uuid AND l.action LIKE 'account.%') ORDER BY l.created_at DESC LIMIT 30`,
        [id],
      )
    ).rows;
    return { user: u, reportsAgainst, invite, notes, history };
  }

  private async audit(actor: string, action: string, target: string, metadata: Record<string, unknown>) {
    await this.pool.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), actor, action, target, metadata]);
  }

  private async target(id: string) {
    const t = (await this.pool.query('SELECT id, status, is_admin, email_verified_at IS NOT NULL AS verified FROM identity.users WHERE id = $1', [id])).rows[0];
    if (!t) throw new NotFoundException('Conta não encontrada');
    return t as { id: string; status: string; is_admin: boolean; verified: boolean };
  }

  /** Confirma o email à mão (por exemplo, quando o email do utilizador não recebe mensagens). */
  async verifyEmail(admin: string, id: string, reason: string) {
    const t = await this.target(id);
    if (t.status === 'deleted') throw new BadRequestException('Conta eliminada');
    await this.pool.query('UPDATE identity.users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [id]);
    await this.audit(admin, 'backoffice.verify_email', `user:${id}`, { reason });
  }

  async suspend(admin: string, id: string, reason: string) {
    const t = await this.target(id);
    if (t.is_admin) throw new ForbiddenException('Não se suspende uma conta de moderação');
    if (t.status !== 'active') throw new BadRequestException('A conta não está ativa');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE identity.users SET status = 'suspended' WHERE id = $1`, [id]);
      await client.query('UPDATE identity.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
      await client.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), admin, 'backoffice.suspend', `user:${id}`, { reason }]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    this.indexer.userRemoved(id);
  }

  async reactivate(admin: string, id: string, reason: string) {
    const t = await this.target(id);
    if (t.status !== 'suspended') throw new BadRequestException('Só se reativam contas suspensas');
    await this.pool.query(`UPDATE identity.users SET status = 'active' WHERE id = $1`, [id]);
    await this.audit(admin, 'backoffice.reactivate', `user:${id}`, { reason });
    this.indexer.userChanged(id);
  }

  async addNote(admin: string, id: string, body: string) {
    await this.target(id);
    await this.pool.query('INSERT INTO audit.staff_notes (id, user_id, author_id, body) VALUES ($1, $2, $3, $4)', [uuidv7(), id, admin, body]);
    await this.audit(admin, 'backoffice.note', `user:${id}`, { length: body.length });
  }

  /** Denúncias já decididas (histórico), agrupadas por conteúdo, com quem decidiu e porquê. */
  async decided(status: 'dismissed' | 'actioned', cursor: string | undefined, limit = 30) {
    const { rows } = await this.pool.query(
      `SELECT r.target_type, r.target_id, count(*)::int AS reports, array_agg(DISTINCT r.reason) AS reasons,
              max(r.resolved_at) AS resolved_at, max(r.resolution) AS resolution, max(r.resolution_note) AS note,
              max(ad.username) AS decided_by, max(tu.username) AS owner_username,
              COALESCE(max(p.body), max(c.body), max(s.caption), max(m.body), '') AS preview,
              ${EVIDENCE_COLUMNS}
         FROM social.reports r
         LEFT JOIN identity.users ad ON ad.id = r.resolved_by
         LEFT JOIN identity.users tu ON tu.id = r.target_user_id
         LEFT JOIN content.posts p ON r.target_type = 'post' AND p.id = r.target_id
         LEFT JOIN content.comments c ON r.target_type = 'comment' AND c.id = r.target_id
         LEFT JOIN content.stories s ON r.target_type = 'story' AND s.id = r.target_id
         LEFT JOIN social.messages m ON r.target_type = 'message' AND m.id = r.target_id
        WHERE r.status = $1 AND ($2::timestamptz IS NULL OR r.resolved_at < $2)
        GROUP BY r.target_type, r.target_id
        ORDER BY max(r.resolved_at) DESC LIMIT $3`,
      [status, cursor ?? null, limit + 1],
    );
    const page = rows.slice(0, limit).map((r) => {
      // Mensagens: o que foi denunciado (a cópia guardada na denúncia) e, se mudou depois, como está agora.
      const proof = messageProof(r);
      return {
        type: r.target_type as string,
        id: r.target_id as string,
        reports: r.reports as number,
        reasons: r.reasons as string[],
        resolvedAt: r.resolved_at as string,
        resolution: r.resolution as string,
        note: (r.note as string | null) ?? null,
        decidedBy: (r.decided_by as string | null) ?? null,
        owner: (r.owner_username as string | null) ?? null,
        preview: String(proof.reported ? proof.reported.body : r.preview).slice(0, 200),
        reported: proof.reported,
        current: proof.current,
      };
    });
    return { items: page, nextCursor: rows.length > limit ? new Date(page[page.length - 1].resolvedAt).toISOString() : null };
  }

  /** O registo de auditoria (só leitura), com filtros. */
  async audit_list(action: string | undefined, actor: string | undefined, cursor: string | undefined, limit = 50) {
    const { rows } = await this.pool.query(
      `SELECT l.id, l.action, l.target, l.metadata, l.created_at, a.username AS actor
         FROM audit.audit_log l LEFT JOIN identity.users a ON a.id = l.actor_id
        WHERE ($1::text IS NULL OR l.action LIKE $1 || '%')
          AND ($2::text IS NULL OR lower(a.username) = lower($2))
          AND ($3::uuid IS NULL OR l.id < $3)
        ORDER BY l.id DESC LIMIT $4`,
      [action || null, actor?.replace(/^@/, '') || null, cursor ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return { items: page, nextCursor: rows.length > limit ? (page[page.length - 1].id as string) : null };
  }
}

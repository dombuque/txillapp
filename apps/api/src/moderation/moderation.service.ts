import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { SearchIndexer } from '../search/search-index';
import { audienceOk } from '../stories/stories.service';
import { canView } from '../social/visibility';

export const REPORT_TYPES = ['post', 'comment', 'story', 'user', 'message', 'media'] as const;
/** O que as pessoas podem denunciar ('media' só é criado pela verificação automática). */
export const USER_REPORT_TYPES = ['post', 'comment', 'story', 'user', 'message'] as const;
export const REPORT_REASONS = ['spam', 'harassment', 'hate', 'nudity', 'violence', 'scam', 'impersonation', 'minor', 'other'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];

@Injectable()
export class ModerationService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly indexer: SearchIndexer,
  ) {}

  async isAdmin(userId: string) {
    const r = await this.pool.query(`SELECT 1 FROM identity.users WHERE id = $1 AND is_admin AND status = 'active'`, [userId]);
    return !!r.rowCount;
  }

  /** Dono do conteúdo, se o denunciante o consegue ver. Lança 404 caso contrário (não revela o que não pode ver). */
  private async ownerIfVisible(reporter: string, type: ReportType, id: string): Promise<string> {
    let sql: string;
    switch (type) {
      case 'post':
        sql = `SELECT p.author_id AS owner FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL WHERE p.id = $2 AND ${canView()}`;
        break;
      case 'comment':
        sql = `SELECT c.author_id AS owner FROM content.comments c JOIN content.posts p ON p.id = c.post_id AND p.removed_at IS NULL
                 JOIN identity.users u ON u.id = p.author_id WHERE c.id = $2 AND ${canView()}`;
        break;
      case 'story':
        sql = `SELECT s.author_id AS owner FROM content.stories s JOIN identity.users u ON u.id = s.author_id
                WHERE s.id = $2 AND s.expires_at > now() AND ${canView()} AND ${audienceOk('s', '$1')}`;
        break;
      case 'media':
        throw new NotFoundException('Conteúdo não encontrado');
      case 'user':
        sql = `SELECT u.id AS owner FROM identity.users u WHERE u.id = $2 AND u.status = 'active'`;
        break;
      case 'message':
        sql = `SELECT m.sender_id AS owner FROM social.messages m JOIN social.conversations c ON c.id = m.conversation_id
                WHERE m.id = $2 AND m.deleted_at IS NULL AND (c.user_a = $1 OR c.user_b = $1)`;
        break;
    }
    const { rows } = await this.pool.query(sql, [reporter, id]);
    if (!rows[0]) throw new NotFoundException('Conteúdo não encontrado');
    return rows[0].owner as string;
  }

  async report(reporter: string, type: Exclude<ReportType, 'media'>, id: string, reason: ReportReason, note?: string) {
    const owner = await this.ownerIfVisible(reporter, type, id);
    if (owner === reporter) throw new BadRequestException('Não podes denunciar o teu próprio conteúdo');
    await this.pool.query(
      `INSERT INTO social.reports (id, reporter_id, target_type, target_id, target_user_id, reason, note) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING`,
      [uuidv7(), reporter, type, id, owner, reason, note || null],
    );
    // Responde sempre o mesmo, mesmo que já tenha denunciado: não é preciso insistir.
  }

  /** Fila de denúncias abertas, agrupadas por conteúdo (quantas pessoas denunciaram e porquê). */
  async queue(status: 'open' | 'dismissed' | 'actioned' = 'open') {
    const { rows } = await this.pool.query(
      `SELECT r.target_type, r.target_id, count(*)::int AS reports, array_agg(DISTINCT r.reason) AS reasons,
              min(r.created_at) AS first_at, min(r.id::text) AS report_id,
              tu.username AS owner_username, tu.display_name AS owner_name, tu.status AS owner_status,
              (SELECT count(*) FROM social.reports x WHERE x.target_user_id = r.target_user_id AND x.status = 'actioned')::int AS owner_strikes,
              COALESCE(p.body, c.body, s.caption, m.body, CASE WHEN r.target_type = 'media' THEN max(r.note) END, '') AS preview
         FROM social.reports r
         LEFT JOIN identity.users tu ON tu.id = r.target_user_id
         LEFT JOIN content.posts p ON r.target_type = 'post' AND p.id = r.target_id
         LEFT JOIN content.comments c ON r.target_type = 'comment' AND c.id = r.target_id
         LEFT JOIN content.stories s ON r.target_type = 'story' AND s.id = r.target_id
         LEFT JOIN social.messages m ON r.target_type = 'message' AND m.id = r.target_id
        WHERE r.status = $1
        GROUP BY r.target_type, r.target_id, r.target_user_id, tu.username, tu.display_name, tu.status, p.body, c.body, s.caption, m.body
        ORDER BY count(*) DESC, min(r.created_at) ASC LIMIT 100`,
      [status],
    );
    return rows.map((r) => ({
      type: r.target_type as ReportType,
      id: r.target_id as string,
      reports: r.reports as number,
      reasons: r.reasons as ReportReason[],
      firstAt: r.first_at as string,
      owner: r.owner_username ? { username: r.owner_username as string, displayName: r.owner_name as string, status: r.owner_status as string, strikes: r.owner_strikes as number } : null,
      preview: (r.preview as string).slice(0, 200),
      imageUrl: r.target_type === 'media' ? `/api/v1/media/${r.target_id}` : null,
    }));
  }

  /**
   * Decide sobre um conteúdo denunciado: ignorar, remover o conteúdo, ou suspender a conta do dono.
   * Fica registado no audit_log e todas as denúncias abertas desse conteúdo fecham juntas.
   */
  async resolve(admin: string, type: ReportType, id: string, action: 'dismiss' | 'remove' | 'suspend') {
    const open = await this.pool.query(`SELECT target_user_id FROM social.reports WHERE target_type = $1 AND target_id = $2 AND status = 'open' LIMIT 1`, [type, id]);
    if (!open.rows[0]) throw new NotFoundException('Sem denúncias abertas para este conteúdo');
    const owner = open.rows[0].target_user_id as string | null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (action === 'remove') {
        const sql = {
          post: `UPDATE content.posts SET removed_at = now(), removed_by = 'moderation' WHERE id = $1 AND removed_at IS NULL`,
          comment: `DELETE FROM content.comments WHERE id = $1`,
          story: `DELETE FROM content.stories WHERE id = $1`,
          message: `UPDATE social.messages SET deleted_at = now(), body = '', media_id = NULL, story_media_id = NULL WHERE id = $1 AND deleted_at IS NULL`,
          media: `UPDATE content.media_assets SET status = 'deleted' WHERE id = $1`,
          user: '',
        }[type];
        if (!sql) throw new BadRequestException('Contas não se removem: suspende-se');
        await client.query(sql, [id]);
      }
      if (action === 'suspend') {
        if (!owner) throw new BadRequestException('Conta desconhecida');
        const isAdminTarget = await client.query('SELECT is_admin FROM identity.users WHERE id = $1', [owner]);
        if (isAdminTarget.rows[0]?.is_admin) throw new ForbiddenException('Não se suspende uma conta de moderação');
        await client.query(`UPDATE identity.users SET status = 'suspended' WHERE id = $1 AND status = 'active'`, [owner]);
        await client.query('UPDATE identity.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [owner]);
      }
      await client.query(
        `UPDATE social.reports SET status = $3, resolution = $4, resolved_by = $5, resolved_at = now()
          WHERE target_type = $1 AND target_id = $2 AND status = 'open'`,
        [type, id, action === 'dismiss' ? 'dismissed' : 'actioned', action, admin],
      );
      await client.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
        uuidv7(), admin, `moderation.${action}`, `${type}:${id}`, { owner },
      ]);
      await client.query('COMMIT');
      if (action === 'remove' && type === 'post') this.indexer.postRemoved(id);
      if (action === 'suspend' && owner) this.indexer.userRemoved(owner);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}

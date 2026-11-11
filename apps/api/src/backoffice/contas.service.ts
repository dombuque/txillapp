import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { describeDevice, SessionState } from '../common/device';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';

/**
 * Backoffice › Contas: a lista de contas (filtros, ordenação, páginas por cursor e CSV), a ficha da conta
 * (resumo, atividade, queixas, notas e histórico da equipa) e as sessões e aparelhos (ver e terminar).
 * Nunca se guarda nem se mostra o endereço IP. Cada consulta às sessões e cada ação fica na auditoria.
 */

export const USER_SORTS = ['recent', 'oldest', 'last_seen', 'reports', 'followers', 'username'] as const;
export type UserSort = (typeof USER_SORTS)[number];

export interface UserFilters {
  q?: string;
  status?: 'active' | 'suspended' | 'deleted';
  /** email: email confirmado; unconfirmed: por confirmar; badge: com selo. */
  verified?: 'email' | 'unconfirmed' | 'badge';
  country?: string;
  /** Registo entre datas (AAAA-MM-DD, as duas incluídas). */
  from?: string;
  to?: string;
  reports?: boolean;
  minors?: boolean;
  sort?: UserSort;
}

/** A última atividade: a presença no chat ou a última renovação de sessão. */
const LAST_SEEN = `greatest(u.last_seen_at, (SELECT max(greatest(s.created_at, s.used_at)) FROM identity.sessions s WHERE s.user_id = u.id))`;
const MINOR = `(u.birth_date IS NOT NULL AND u.birth_date > current_date - interval '18 years')`;

const SORTS: Record<UserSort, { expr: string; cast: 'timestamptz' | 'bigint' | 'text'; dir: 'ASC' | 'DESC' }> = {
  recent: { expr: 'u.created_at', cast: 'timestamptz', dir: 'DESC' },
  oldest: { expr: 'u.created_at', cast: 'timestamptz', dir: 'ASC' },
  last_seen: { expr: `coalesce(${LAST_SEEN}, 'epoch'::timestamptz)`, cast: 'timestamptz', dir: 'DESC' },
  reports: { expr: '(SELECT count(*) FROM social.reports r WHERE r.target_user_id = u.id)', cast: 'bigint', dir: 'DESC' },
  followers: { expr: '(SELECT count(*) FROM social.follows f WHERE f.followee_id = u.id)', cast: 'bigint', dir: 'DESC' },
  username: { expr: 'lower(u.username)', cast: 'text', dir: 'ASC' },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function encodeCursor(sort: UserSort, sk: string, id: string) {
  return Buffer.from(JSON.stringify([sort, sk, id])).toString('base64url');
}
function decodeCursor(sort: UserSort, raw: string | undefined): { sk: string; id: string } | null {
  if (!raw || raw.length > 300) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(v) || v.length !== 3 || v[0] !== sort || typeof v[1] !== 'string' || v[1].length > 120 || typeof v[2] !== 'string' || !UUID.test(v[2])) return null;
    if (SORTS[sort].cast === 'bigint' && !/^\d{1,12}$/.test(v[1])) return null;
    if (SORTS[sort].cast === 'timestamptz' && Number.isNaN(Date.parse(v[1].replace(' ', 'T')))) return null;
    return { sk: v[1], id: v[2] };
  } catch {
    return null;
  }
}

/** Uma célula de CSV: entre aspas, e sem fórmulas (o Excel executa o que começa por = + - @). */
const cell = (v: unknown) => {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

interface FamilyRow { family_id: string; first_seen: Date; last_active: Date; expires_at: Date; revoked_at: Date | null; ua: string | null; rows: number }

@Injectable()
export class ContasService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async audit(actor: string, action: string, target: string | null, metadata: Record<string, unknown>) {
    await this.pool.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), actor, action, target, metadata]);
  }

  /** Lê e valida os filtros vindos do pedido (o que não for válido é ignorado). */
  static filters(q: Record<string, string | undefined>): UserFilters {
    const yes = (v?: string) => v === '1' || v === 'true';
    const date = (v?: string) => (v && DAY.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined);
    return {
      q: q.q?.slice(0, 100),
      status: q.status && ['active', 'suspended', 'deleted'].includes(q.status) ? (q.status as UserFilters['status']) : undefined,
      verified: q.verified && ['email', 'unconfirmed', 'badge'].includes(q.verified) ? (q.verified as UserFilters['verified']) : undefined,
      country: q.country && /^[A-Za-z]{2}$/.test(q.country) ? q.country.toUpperCase() : undefined,
      from: date(q.from),
      to: date(q.to),
      reports: yes(q.reports),
      minors: yes(q.minors),
      sort: (USER_SORTS as readonly string[]).includes(q.sort ?? '') ? (q.sort as UserSort) : 'recent',
    };
  }

  /** O WHERE dos filtros (com os parâmetros a partir de `params`). */
  private where(f: UserFilters, params: unknown[]): string {
    const w = [`u.status <> 'staff'`];
    const p = (v: unknown) => `$${params.push(v)}`;
    const term = (f.q ?? '').trim().replace(/^@/, '');
    if (term) {
      const like = p(`%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      w.push(`(u.username ILIKE ${like} ESCAPE '\\' OR u.display_name ILIKE ${like} ESCAPE '\\' OR u.email ILIKE ${like} ESCAPE '\\')`);
    }
    if (f.status) w.push(`u.status = ${p(f.status)}`);
    if (f.verified === 'email') w.push('u.email_verified_at IS NOT NULL');
    if (f.verified === 'unconfirmed') w.push('u.email_verified_at IS NULL');
    if (f.verified === 'badge') w.push('u.verified_tier IS NOT NULL');
    if (f.country) w.push(`u.country = ${p(f.country)}`);
    if (f.from) w.push(`u.created_at >= ${p(f.from)}::date`);
    if (f.to) w.push(`u.created_at < ${p(f.to)}::date + 1`);
    if (f.reports) w.push('EXISTS (SELECT 1 FROM social.reports r WHERE r.target_user_id = u.id)');
    if (f.minors) w.push(MINOR);
    return w.join(' AND ');
  }

  /** Os ids de uma página, já ordenados, e o valor de ordenação de cada um (para o cursor). */
  private async pageIds(f: UserFilters, cursor: string | undefined, limit: number) {
    const sort = f.sort ?? 'recent';
    const s = SORTS[sort];
    const params: unknown[] = [];
    let where = this.where(f, params);
    const c = decodeCursor(sort, cursor);
    if (c) {
      params.push(c.sk, c.id);
      where += ` AND ((${s.expr}), u.id) ${s.dir === 'DESC' ? '<' : '>'} ($${params.length - 1}::${s.cast}, $${params.length}::uuid)`;
    }
    params.push(limit + 1);
    const { rows } = await this.pool.query<{ id: string; sk: string }>(
      `SELECT u.id, (${s.expr})::text AS sk FROM identity.users u WHERE ${where} ORDER BY ${s.expr} ${s.dir}, u.id ${s.dir} LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return { ids: page.map((r) => r.id), nextCursor: rows.length > limit && last ? encodeCursor(sort, last.sk, last.id) : null };
  }

  /** As linhas da lista para estes ids, pela mesma ordem. */
  private async rowsFor(ids: string[]) {
    if (!ids.length) return [];
    const { rows } = await this.pool.query(
      `SELECT u.id, u.username, u.display_name, u.email, u.status, u.is_admin, u.created_at, u.country,
              u.email_verified_at IS NOT NULL AS verified, u.verified_tier AS badge, ${MINOR} AS minor,
              (SELECT count(*) FROM content.posts p WHERE p.author_id = u.id AND p.removed_at IS NULL)::int AS posts,
              (SELECT count(*) FROM social.follows f WHERE f.followee_id = u.id)::int AS followers,
              (SELECT count(*) FROM social.reports r WHERE r.target_user_id = u.id)::int AS reports,
              (SELECT count(*) FROM social.reports r WHERE r.target_user_id = u.id AND r.status = 'open')::int AS reports_open,
              ${LAST_SEEN} AS last_seen
         FROM identity.users u WHERE u.id = ANY($1::uuid[])`,
      [ids],
    );
    const by = new Map(rows.map((r) => [r.id as string, r]));
    return ids.map((id) => by.get(id)).filter(Boolean) as Record<string, unknown>[];
  }

  /** Lista de contas: pesquisa, filtros, ordenação e páginas por cursor. */
  async list(f: UserFilters, cursor: string | undefined, limit = 30) {
    const { ids, nextCursor } = await this.pageIds(f, cursor, limit);
    return { items: await this.rowsFor(ids), nextCursor };
  }

  /** CSV com os mesmos filtros, só com campos não sensíveis (sem email, nome, data de nascimento nem idade). Fica na auditoria. */
  async exportCsv(actor: string, f: UserFilters, max = 5000) {
    const { ids } = await this.pageIds(f, undefined, max);
    const rows = await this.rowsFor(ids);
    const head = ['id', 'username', 'estado', 'pais', 'email_confirmado', 'selo', 'criada', 'ultima_atividade', 'publicacoes', 'seguidores', 'queixas_recebidas'];
    const lines = rows.map((r) => [
      r.id, r.username, r.status, r.country ?? '', r.verified ? 'sim' : 'não', r.badge ?? '', r.created_at,
      r.last_seen ?? '', r.posts, r.followers, r.reports,
    ].map(cell).join(','));
    const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== false && v !== ''));
    await this.audit(actor, 'backoffice.users_export', 'users', { filters: clean, rows: rows.length });
    return { csv: `﻿${head.join(',')}\r\n${lines.join('\r\n')}${lines.length ? '\r\n' : ''}`, rows: rows.length };
  }

  /** A ficha de uma conta: resumo, atividade, queixas feitas e recebidas, convites, notas e o que a equipa já fez nela. */
  async user(id: string) {
    const u = (
      await this.pool.query(
        `SELECT u.id, u.username, u.display_name, u.email, u.status, u.is_admin, u.is_private, u.created_at, u.country, u.city,
                u.terms_version, u.terms_accepted_at, u.email_verified_at, u.verified_tier AS badge, u.avatar_media_id IS NOT NULL AS has_avatar,
                CASE WHEN u.birth_date IS NULL THEN NULL ELSE date_part('year', age(u.birth_date))::int END AS age,
                ${MINOR} AS minor,
                (SELECT count(*) FROM content.posts p WHERE p.author_id = u.id AND p.removed_at IS NULL)::int AS posts,
                (SELECT count(*) FROM content.posts p WHERE p.author_id = u.id AND p.removed_by = 'moderation')::int AS posts_removed,
                (SELECT count(*) FROM content.stories s WHERE s.author_id = u.id)::int AS stories,
                (SELECT count(*) FROM content.comments c WHERE c.author_id = u.id)::int AS comments,
                (SELECT count(*) FROM social.follows f WHERE f.followee_id = u.id)::int AS followers,
                (SELECT count(*) FROM social.follows f WHERE f.follower_id = u.id)::int AS following,
                (SELECT count(*) FROM social.messages m WHERE m.sender_id = u.id)::int AS messages,
                (SELECT count(DISTINCT s.family_id) FROM identity.sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now())::int AS sessions,
                (SELECT max(s.created_at) FROM identity.sessions s WHERE s.user_id = u.id) AS last_seen,
                ${LAST_SEEN} AS last_active,
                coalesce((SELECT balance FROM ledger.accounts a WHERE a.user_id = u.id), 0)::bigint AS txills
           FROM identity.users u WHERE u.id = $1 AND u.status <> 'staff'`,
        [id],
      )
    ).rows[0];
    if (!u) throw new NotFoundException('Conta não encontrada');
    const [recentPosts, reportsAgainst, reportsMade, invite, notes, history] = await Promise.all([
      this.pool.query(
        `SELECT p.id, left(p.body, 160) AS body, p.created_at, p.removed_at, p.removed_by, p.kind, (SELECT count(*) FROM content.post_media pm WHERE pm.post_id = p.id)::int AS media
           FROM content.posts p WHERE p.author_id = $1 ORDER BY p.id DESC LIMIT 10`,
        [id],
      ),
      this.pool.query(
        `SELECT r.target_type, r.target_id, r.reason, r.status, r.resolution, r.resolution_note, r.created_at, ru.username AS reporter
           FROM social.reports r LEFT JOIN identity.users ru ON ru.id = r.reporter_id
          WHERE r.target_user_id = $1 ORDER BY r.created_at DESC LIMIT 30`,
        [id],
      ),
      this.pool.query(
        `SELECT r.target_type, r.target_id, r.reason, r.status, r.created_at, tu.username AS target_owner
           FROM social.reports r LEFT JOIN identity.users tu ON tu.id = r.target_user_id
          WHERE r.reporter_id = $1 ORDER BY r.created_at DESC LIMIT 30`,
        [id],
      ),
      this.pool.query(
        `SELECT (SELECT count(*) FROM social.referrals WHERE inviter_id = $1)::int AS invited,
                (SELECT count(*) FROM social.referrals WHERE inviter_id = $1 AND status = 'paid')::int AS paid,
                (SELECT row_to_json(x) FROM (SELECT r.status, r.reason, iu.username AS inviter FROM social.referrals r JOIN identity.users iu ON iu.id = r.inviter_id WHERE r.invitee_id = $1) x) AS came_from`,
        [id],
      ),
      this.pool.query(
        `SELECT n.id, n.body, n.created_at, a.username AS author, sa.name AS author_name
           FROM audit.staff_notes n LEFT JOIN identity.users a ON a.id = n.author_id LEFT JOIN identity.staff_accounts sa ON sa.user_id = n.author_id
          WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 50`,
        [id],
      ),
      this.pool.query(
        `SELECT l.action, l.metadata, l.created_at, a.username AS actor, sa.name AS actor_name, (l.actor_id IS DISTINCT FROM $1::uuid) AS by_staff
           FROM audit.audit_log l LEFT JOIN identity.users a ON a.id = l.actor_id LEFT JOIN identity.staff_accounts sa ON sa.user_id = l.actor_id
          WHERE l.target = 'user:' || $1::text OR (l.actor_id = $1::uuid AND l.action LIKE 'account.%') ORDER BY l.created_at DESC LIMIT 50`,
        [id],
      ),
    ]);
    const reportCounts = (
      await this.pool.query(
        `SELECT (SELECT count(*) FROM social.reports WHERE target_user_id = $1)::int AS against,
                (SELECT count(*) FROM social.reports WHERE target_user_id = $1 AND status = 'open')::int AS against_open,
                (SELECT count(*) FROM social.reports WHERE reporter_id = $1)::int AS made`,
        [id],
      )
    ).rows[0];
    return {
      user: u,
      recentPosts: recentPosts.rows,
      reportsAgainst: reportsAgainst.rows,
      reportsMade: reportsMade.rows,
      reportCounts,
      invite: invite.rows[0],
      notes: notes.rows,
      history: history.rows,
    };
  }

  private async exists(id: string) {
    const t = (await this.pool.query(`SELECT id FROM identity.users WHERE id = $1 AND status <> 'staff'`, [id])).rows[0];
    if (!t) throw new NotFoundException('Conta não encontrada');
  }

  private static state(f: Pick<FamilyRow, 'expires_at' | 'revoked_at'>): SessionState {
    if (f.revoked_at && new Date(f.revoked_at) < new Date(f.expires_at)) return 'ended';
    if (new Date(f.expires_at) <= new Date()) return 'expired';
    return f.revoked_at ? 'ended' : 'active';
  }

  /** Sessões (uma linha por login, ou seja, por família de tokens) e aparelhos com notificações. Fica na auditoria. */
  async sessions(actor: string, id: string) {
    await this.exists(id);
    const { rows } = await this.pool.query<FamilyRow>(
      `SELECT family_id, min(created_at) AS first_seen, max(greatest(created_at, used_at)) AS last_active,
              (array_agg(expires_at ORDER BY created_at DESC))[1] AS expires_at,
              (array_agg(revoked_at ORDER BY created_at DESC))[1] AS revoked_at,
              (array_agg(user_agent ORDER BY created_at DESC))[1] AS ua,
              count(*)::int AS rows
         FROM identity.sessions WHERE user_id = $1
        GROUP BY family_id ORDER BY max(greatest(created_at, used_at)) DESC LIMIT 50`,
      [id],
    );
    const sessions = rows.map((r) => {
      const d = describeDevice(r.ua);
      const state = ContasService.state(r);
      return {
        id: r.family_id,
        device: d.label,
        kind: d.kind,
        mobile: d.mobile,
        loginAt: r.first_seen,
        lastActiveAt: r.last_active,
        expiresAt: r.expires_at,
        endedAt: state === 'ended' ? r.revoked_at : null,
        state,
      };
    });
    const devices = (
      await this.pool.query(`SELECT platform, created_at, updated_at FROM social.push_devices WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 20`, [id])
    ).rows.map((d) => ({ platform: d.platform as 'android' | 'ios', createdAt: d.created_at, updatedAt: d.updated_at }));
    const webPush = (await this.pool.query('SELECT count(*)::int AS n FROM social.push_subscriptions WHERE user_id = $1', [id])).rows[0].n as number;
    await this.audit(actor, 'backoffice.sessions_view', `user:${id}`, { sessions: sessions.length, active: sessions.filter((s) => s.state === 'active').length });
    return { sessions, devices, webPush };
  }

  /** Termina uma sessão (um login). O aparelho sai quando o acesso atual caducar (poucos minutos). */
  async revokeSession(actor: string, id: string, family: string, reason: string) {
    await this.exists(id);
    const f = (
      await this.pool.query(
        `SELECT (array_agg(user_agent ORDER BY created_at DESC))[1] AS ua FROM identity.sessions WHERE user_id = $1 AND family_id = $2 GROUP BY family_id`,
        [id, family],
      )
    ).rows[0];
    if (!f) throw new NotFoundException('Sessão não encontrada');
    const r = await this.pool.query('UPDATE identity.sessions SET revoked_at = now() WHERE user_id = $1 AND family_id = $2 AND revoked_at IS NULL AND expires_at > now()', [id, family]);
    if (!r.rowCount) throw new BadRequestException('Esta sessão já tinha terminado');
    await this.audit(actor, 'backoffice.session_revoke', `user:${id}`, { family, device: describeDevice(f.ua).label, reason });
  }

  /** Termina todas as sessões da conta e desliga as notificações nos telemóveis (voltam quando a pessoa entrar outra vez). */
  async revokeAll(actor: string, id: string, reason: string) {
    await this.exists(id);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `WITH x AS (UPDATE identity.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() RETURNING family_id)
         SELECT count(DISTINCT family_id)::int AS n FROM x`,
        [id],
      );
      const pushed = await client.query('DELETE FROM social.push_devices WHERE user_id = $1', [id]);
      const sessions = r.rows[0].n as number;
      await client.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
        uuidv7(), actor, 'backoffice.sessions_revoke_all', `user:${id}`, { sessions, pushDevices: pushed.rowCount ?? 0, reason },
      ]);
      await client.query('COMMIT');
      return { sessions };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}

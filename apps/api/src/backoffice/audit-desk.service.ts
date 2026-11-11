import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';

export interface AuditFilter { actor?: string; action?: string; target?: string; from?: string; to?: string; cursor?: string }

/** Linhas de um CSV: aspas à volta e aspas dobradas; fórmulas (=, +, -, @) neutralizadas para não correrem no Excel. */
const cell = (v: unknown) => {
  let s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

/**
 * O registo de auditoria no backoffice: filtros por pessoa da equipa, ação, alvo e datas, nomes legíveis (a pessoa da equipa
 * pelo nome, as contas pelo @) e exportação em CSV, que também fica no registo.
 */
@Injectable()
export class AuditDeskService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private where(f: AuditFilter, params: unknown[]) {
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const w: string[] = [];
    if (f.actor) w.push(/^[0-9a-f-]{36}$/i.test(f.actor) ? `l.actor_id = ${p(f.actor)}::uuid` : `(lower(a.username) = lower(${p(f.actor.replace(/^@/, ''))}) OR lower(a.display_name) = lower($${params.length}))`);
    if (f.action) w.push(f.action.endsWith('.') ? `l.action LIKE ${p(`${f.action.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)} ESCAPE '\\'` : `l.action = ${p(f.action)}`);
    if (f.target) {
      const t = f.target.trim().replace(/^@/, '');
      // Um @ de uma conta: o que se fez a essa conta e ao conteúdo dela. Senão: o alvo contém o texto (por exemplo, um id).
      w.push(`(l.target ILIKE ${p(`%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)} ESCAPE '\\'
               OR EXISTS (SELECT 1 FROM identity.users tu WHERE lower(tu.username) = lower(${p(t)}) AND (l.target = 'user:' || tu.id::text OR l.metadata->>'owner' = tu.id::text)))`);
    }
    if (f.from) w.push(`l.created_at >= ${p(f.from)}::timestamptz`);
    if (f.to) w.push(`l.created_at < ${p(f.to)}::timestamptz + interval '1 day'`);
    if (f.cursor) w.push(`l.id < ${p(f.cursor)}::uuid`);
    return w.length ? `WHERE ${w.join(' AND ')}` : '';
  }

  private async rows(f: AuditFilter, limit: number) {
    const params: unknown[] = [];
    const where = this.where(f, params);
    params.push(limit);
    const { rows } = await this.pool.query(
      `SELECT l.id, l.action, l.target, l.metadata, l.created_at, a.username AS actor, a.display_name AS actor_name, a.status = 'staff' OR a.is_admin AS actor_staff
         FROM audit.audit_log l LEFT JOIN identity.users a ON a.id = l.actor_id
        ${where}
        ORDER BY l.id DESC LIMIT $${params.length}`,
      params,
    );
    // Nomes legíveis: o @ das contas que são alvo (user:<id>) ou dono do conteúdo (metadata.owner).
    const ids = new Set<string>();
    for (const r of rows) {
      const m = /^user:([0-9a-f-]{36})$/.exec(r.target ?? '');
      if (m) ids.add(m[1]);
      if (typeof r.metadata?.owner === 'string' && /^[0-9a-f-]{36}$/.test(r.metadata.owner)) ids.add(r.metadata.owner);
    }
    const names = new Map<string, string>();
    if (ids.size) for (const u of (await this.pool.query('SELECT id, username, status FROM identity.users WHERE id = ANY($1::uuid[])', [[...ids]])).rows) names.set(u.id, u.status === 'staff' ? 'equipa' : `@${u.username}`);
    return rows.map((r) => {
      const m = /^user:([0-9a-f-]{36})$/.exec(r.target ?? '');
      return {
        id: r.id as string,
        action: r.action as string,
        target: (r.target as string | null) ?? null,
        targetLabel: m ? names.get(m[1]) ?? null : null,
        ownerLabel: typeof r.metadata?.owner === 'string' ? names.get(r.metadata.owner) ?? null : null,
        metadata: (r.metadata as Record<string, unknown>) ?? {},
        created_at: r.created_at as string,
        actor: (r.actor as string | null) ?? null,
        actorName: r.actor_staff ? ((r.actor_name as string | null) ?? null) : r.actor ? `@${r.actor as string}` : null,
        actorStaff: !!r.actor_staff,
      };
    });
  }

  async search(f: AuditFilter, limit = 50) {
    const rows = await this.rows(f, limit + 1);
    const page = rows.slice(0, limit);
    return { items: page, nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }

  /** Para os filtros: as pessoas da equipa e as ações que existem no registo. */
  async facets() {
    const staff = (
      await this.pool.query(
        `SELECT u.id, u.display_name, u.username FROM identity.users u WHERE u.status = 'staff' OR (u.is_admin AND u.status = 'active') ORDER BY lower(u.display_name)`,
      )
    ).rows.map((r) => ({ id: r.id as string, name: r.display_name as string, username: r.username as string }));
    const actions = (await this.pool.query(`SELECT action, count(*)::int AS n FROM audit.audit_log GROUP BY action ORDER BY action`)).rows.map((r) => ({ action: r.action as string, count: r.n as number }));
    return { staff, actions };
  }

  /** Até 5000 linhas em CSV (com BOM, para o Excel abrir em UTF-8). A exportação fica no registo, com os filtros. */
  async exportCsv(actor: string, f: AuditFilter) {
    const rows = await this.rows({ ...f, cursor: undefined }, 5000);
    const head = ['quando', 'quem', 'acao', 'alvo', 'conta', 'motivo', 'detalhe'];
    const lines = rows.map((r) => {
      const md = r.metadata as Record<string, unknown>;
      const reason = md.reason ?? md.note ?? md.motivo ?? '';
      return [new Date(r.created_at).toISOString(), r.actorName ?? r.actor ?? '', r.action, r.target ?? '', r.targetLabel ?? r.ownerLabel ?? '', reason, md].map(cell).join(',');
    });
    await this.pool.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
      uuidv7(), actor, 'backoffice.audit_export', 'audit', { filters: Object.fromEntries(Object.entries(f).filter(([k, v]) => v && k !== 'cursor')), rows: rows.length },
    ]);
    return `﻿${[head.join(','), ...lines].join('\r\n')}\r\n`;
  }
}

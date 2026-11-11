import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { normalizeTag } from '../common/hashtags';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import type { Kind } from './geleira.service';

export interface CatalogFilter { status: 'pending' | 'curated' | 'rejected' | 'all'; kind?: Kind; q?: string; country?: string }
export interface CatalogEdit { name?: string; kind?: Kind; category?: string; alcoholic?: boolean; countries?: string[] | null }

const fold = (s: string) => `translate(lower(${s}), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;
const slugOf = (kind: string, name: string) => `${kind}-${normalizeTag(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

/**
 * O catálogo da Geleira no backoffice: as sugestões da malta (aprovar ou rejeitar, uma ou várias), editar um item
 * (nome, tipo, grupo, álcool e os países onde faz sentido) e criar itens novos. Tudo fica no registo de auditoria.
 */
@Injectable()
export class GeleiraAdminService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private audit(actor: string, action: string, target: string, metadata: Record<string, unknown>) {
    return this.pool.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), actor, action, target, metadata]);
  }

  async list(f: CatalogFilter) {
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const w: string[] = [];
    if (f.status !== 'all') w.push(`i.status = ${p(f.status)}`);
    if (f.kind) w.push(`i.kind = ${p(f.kind)}`);
    const term = f.q ? normalizeTag(f.q).replace(/[^a-z0-9 ]+/g, ' ').trim() : '';
    if (term) w.push(`(${fold('i.name')} LIKE ${p(`%${term}%`)} OR i.category LIKE $${params.length})`);
    if (f.country === 'global') w.push('i.countries IS NULL');
    else if (f.country) w.push(`${p(f.country)} = ANY(i.countries)`);
    const { rows } = await this.pool.query(
      `SELECT i.id, i.slug, i.name, i.kind, i.category, i.alcoholic, i.status, i.countries, i.created_at,
              u.username AS suggested_by, u.country AS suggested_country,
              (SELECT count(*)::int FROM taste.user_items f WHERE f.item_id = i.id) AS fans,
              (SELECT d.id FROM taste.items d WHERE d.id <> i.id AND d.status = 'curated' AND ${fold('d.name')} = ${fold('i.name')} AND d.kind = i.kind LIMIT 1) AS duplicate_of
         FROM taste.items i LEFT JOIN identity.users u ON u.id = i.created_by
        ${w.length ? `WHERE ${w.join(' AND ')}` : ''}
        ORDER BY (i.status = 'pending') DESC, CASE WHEN i.status = 'pending' THEN i.created_at END ASC, i.kind, i.category, i.name LIMIT 500`,
      params,
    );
    const counts = (await this.pool.query(`SELECT status, count(*)::int AS n FROM taste.items GROUP BY status`)).rows;
    const categories = (await this.pool.query(`SELECT kind, category, count(*)::int AS n FROM taste.items WHERE status = 'curated' GROUP BY kind, category ORDER BY kind, category`)).rows;
    const countries = (await this.pool.query(`SELECT c, count(*)::int AS n FROM taste.items, unnest(countries) c GROUP BY c ORDER BY c`)).rows;
    return {
      items: rows.map((r) => ({
        id: r.id as string, slug: r.slug as string, name: r.name as string, kind: r.kind as Kind, category: r.category as string, alcoholic: r.alcoholic as boolean,
        status: r.status as string, countries: (r.countries as string[] | null) ?? null, createdAt: r.created_at as string,
        suggestedBy: (r.suggested_by as string | null) ?? null, suggestedCountry: (r.suggested_country as string | null) ?? null,
        fans: r.fans as number, duplicateOf: (r.duplicate_of as string | null) ?? null,
      })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>,
      categories: categories.map((c) => ({ kind: c.kind as Kind, category: c.category as string, count: c.n as number })),
      countries: countries.map((c) => ({ country: c.c as string, count: c.n as number })),
    };
  }

  /** Aprovar ou rejeitar sugestões (uma ou várias). Devolve quantas mudaram. */
  async decide(actor: string, ids: string[], approve: boolean, reason?: string) {
    const r = await this.pool.query(`UPDATE taste.items SET status = $2 WHERE id = ANY($1::uuid[]) AND status = 'pending' RETURNING id, name`, [ids, approve ? 'curated' : 'rejected']);
    if (!r.rowCount) throw new NotFoundException('Nenhum destes itens está pendente');
    for (const x of r.rows) await this.audit(actor, approve ? 'catalog.approve' : 'catalog.reject', `taste_item:${x.id}`, { name: x.name, reason: reason || undefined, ...(ids.length > 1 ? { batch: ids.length } : {}) });
    return { changed: r.rowCount };
  }

  async edit(actor: string, id: string, b: CatalogEdit, reason: string) {
    const cur = (await this.pool.query('SELECT id, name, kind, category, alcoholic, countries, status FROM taste.items WHERE id = $1', [id])).rows[0];
    if (!cur) throw new NotFoundException('Item não encontrado');
    const next = { name: b.name ?? cur.name, kind: b.kind ?? cur.kind, category: b.category ?? cur.category, alcoholic: b.alcoholic ?? cur.alcoholic, countries: b.countries === undefined ? cur.countries : b.countries };
    if (next.alcoholic && next.kind !== 'bebida') throw new BadRequestException('Só as bebidas podem ser alcoólicas');
    if ((b.name && b.name !== cur.name) || (b.kind && b.kind !== cur.kind)) {
      const dup = await this.pool.query(`SELECT 1 FROM taste.items WHERE id <> $1 AND status = 'curated' AND kind = $2 AND ${fold('name')} = ${fold('$3::text')}`, [id, next.kind, next.name]);
      if (dup.rowCount) throw new ConflictException('Já existe um item aprovado com este nome');
    }
    await this.pool.query('UPDATE taste.items SET name = $2, kind = $3, category = $4, alcoholic = $5, countries = $6 WHERE id = $1', [id, next.name, next.kind, next.category, next.alcoholic, next.countries?.length ? next.countries : null]);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (JSON.stringify(cur[k] ?? null) !== JSON.stringify(next[k] ?? null)) changes[k] = { from: cur[k] ?? null, to: next[k] ?? null };
    await this.audit(actor, 'catalog.edit', `taste_item:${id}`, { name: next.name, reason, changes });
  }

  async create(actor: string, b: Required<Omit<CatalogEdit, 'countries'>> & { countries: string[] | null }, reason: string) {
    if (b.alcoholic && b.kind !== 'bebida') throw new BadRequestException('Só as bebidas podem ser alcoólicas');
    const slug = slugOf(b.kind, b.name);
    if (slug.length < b.kind.length + 3) throw new BadRequestException('Dá um nome a sério ao item');
    const dup = await this.pool.query(`SELECT 1 FROM taste.items WHERE status = 'curated' AND kind = $1 AND ${fold('name')} = ${fold('$2::text')}`, [b.kind, b.name]);
    if (dup.rowCount) throw new ConflictException('Já existe um item aprovado com este nome');
    const taken = await this.pool.query('SELECT 1 FROM taste.items WHERE slug = $1', [slug]);
    const id = uuidv7();
    await this.pool.query(
      `INSERT INTO taste.items (id, slug, name, kind, category, alcoholic, status, countries) VALUES ($1, $2, $3, $4, $5, $6, 'curated', $7)`,
      [id, taken.rowCount ? `${slug}-${id.slice(-6)}` : slug, b.name, b.kind, b.category, b.alcoholic, b.countries?.length ? b.countries : null],
    );
    await this.audit(actor, 'catalog.create', `taste_item:${id}`, { name: b.name, kind: b.kind, category: b.category, reason });
    return { id };
  }
}

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { ageOf } from '@txillapp/shared';
import { PG_POOL } from '../db/db.module';
import { normalizeTag } from '../common/hashtags';
import { uuidv7 } from '../common/uuid7';
import { canView } from '../social/visibility';

export const KINDS = ['vibe', 'bebida', 'comida', 'sitio'] as const;
export type Kind = (typeof KINDS)[number];
export type Visibility = 'everyone' | 'followers' | 'me';

/** Máximo de itens na geleira de cada pessoa. */
export const MAX_ITEMS = 200;
/** Idade a partir da qual existem bebidas alcoólicas. */
const ADULT = 18;

/** Letras sem acentos, minúsculas, para comparar nomes ("Pastéis de nata" = "pasteis de nata"). */
const fold = (s: string) => `translate(lower(${s}), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;

/* ───────────── valor da geleira em Txills ─────────────
 * Valor de estatuto (não é saldo: não se gasta nem se transfere). Cada item vale:
 *   base do tipo × nota de gelo × raridade × favorito
 * Raridade = 1 + 1/√fãs: o que quase ninguém tem vale mais do que o que toda a gente tem.
 * Prateleira cheia (3+ itens de um tipo) dá +5% ao total, por tipo (até +20%). */
const BASE: Record<Kind, number> = { vibe: 15, bebida: 20, comida: 20, sitio: 30 };
const ICE_MULT = [0.5, 1, 1.5, 2, 3, 4]; // índice = nota (0 = guardado sem nota)
export const itemValue = (kind: Kind, rating: number | null, favorite: boolean, fans: number) =>
  Math.round(BASE[kind] * ICE_MULT[rating ?? 0] * (1 + 1 / Math.sqrt(Math.max(1, fans))) * (favorite ? 1.5 : 1));

export const LEVELS = [
  { at: 0, name: 'Geleira vazia' },
  { at: 1, name: 'Frigobar' },
  { at: 250, name: 'Geleira de bairro' },
  { at: 800, name: 'Geleira de rachar' },
  { at: 2000, name: 'Câmara frigorífica' },
  { at: 5000, name: 'Lenda do gelo' },
];

interface ItemRow {
  id: string;
  slug: string;
  name: string;
  kind: Kind;
  category: string;
  alcoholic: boolean;
  status: string;
  created_by: string | null;
}
const itemOut = (r: ItemRow, viewer: string) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  category: r.category,
  alcoholic: r.alcoholic,
  // Item sugerido por mim que ainda ninguém aprovou: só eu o vejo.
  pending: r.status === 'pending' && r.created_by === viewer,
});

@Injectable()
export class GeleiraService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Menores (ou sem data de nascimento) não têm álcool: nem veem, nem adicionam. */
  private async isAdult(userId: string) {
    const { rows } = await this.pool.query('SELECT birth_date::text AS b FROM identity.users WHERE id = $1', [userId]);
    return !!rows[0]?.b && ageOf(rows[0].b) >= ADULT;
  }

  /** Catálogo para escolher: itens aprovados mais os que eu sugeri, com marca dos que já tenho. */
  async catalog(userId: string, q: { q?: string; kind?: Kind }) {
    const adult = await this.isAdult(userId);
    const params: unknown[] = [userId, adult];
    let where = `(i.status = 'curated' OR (i.status = 'pending' AND i.created_by = $1)) AND ($2 OR NOT i.alcoholic)`;
    if (q.kind) {
      params.push(q.kind);
      where += ` AND i.kind = $${params.length}`;
    }
    const term = q.q ? normalizeTag(q.q).replace(/[^a-z0-9 ]+/g, ' ').trim() : '';
    if (term) {
      params.push(`%${term}%`);
      where += ` AND ${fold('i.name')} LIKE $${params.length}`;
    }
    const { rows } = await this.pool.query(
      `SELECT i.id, i.slug, i.name, i.kind, i.category, i.alcoholic, i.status, i.created_by,
              (SELECT count(*)::int FROM taste.user_items f WHERE f.item_id = i.id) AS fans,
              (m.user_id IS NOT NULL) AS mine, m.rating, COALESCE(m.favorite, false) AS favorite, COALESCE(m.visibility, 'everyone') AS visibility
         FROM taste.items i LEFT JOIN taste.user_items m ON m.item_id = i.id AND m.user_id = $1
        WHERE ${where}
        ORDER BY fans DESC, i.name LIMIT 400`,
      params,
    );
    return rows.map((r) => ({ ...itemOut(r, userId), mine: r.mine as boolean, rating: r.rating as number | null, favorite: r.favorite as boolean, visibility: r.visibility as Visibility, fans: r.fans as number }));
  }

  /** A minha geleira completa, com visibilidade de cada item. */
  async mine(userId: string) {
    const adult = await this.isAdult(userId);
    const { rows } = await this.pool.query(
      `SELECT i.id, i.slug, i.name, i.kind, i.category, i.alcoholic, i.status, i.created_by,
              ui.rating, ui.favorite, ui.visibility
         FROM taste.user_items ui JOIN taste.items i ON i.id = ui.item_id
        WHERE ui.user_id = $1 AND i.status <> 'rejected' AND ($2 OR NOT i.alcoholic)
        ORDER BY ui.favorite DESC, ui.rating DESC NULLS LAST, ui.updated_at DESC`,
      [userId, adult],
    );
    return rows.map((r) => ({ ...itemOut(r, userId), rating: r.rating as number | null, favorite: r.favorite as boolean, visibility: r.visibility as Visibility }));
  }

  /** Guardar ou alterar um item da minha geleira (nota, favorito, visibilidade). Repetir o pedido dá o mesmo resultado. */
  async put(userId: string, itemId: string, b: { rating?: number | null; favorite?: boolean; visibility?: Visibility }) {
    const adult = await this.isAdult(userId);
    const { rows } = await this.pool.query(
      `SELECT alcoholic FROM taste.items WHERE id = $1 AND (status = 'curated' OR (status = 'pending' AND created_by = $2))`,
      [itemId, userId],
    );
    if (!rows[0]) throw new NotFoundException('Esse item não existe');
    if (rows[0].alcoholic && !adult) throw new NotFoundException('Esse item não existe');

    const has = await this.pool.query('SELECT 1 FROM taste.user_items WHERE user_id = $1 AND item_id = $2', [userId, itemId]);
    if (!has.rowCount) {
      const n = await this.pool.query('SELECT count(*)::int AS n FROM taste.user_items WHERE user_id = $1', [userId]);
      if (n.rows[0].n >= MAX_ITEMS) throw new ConflictException(`A geleira está cheia (${MAX_ITEMS} itens). Tira alguma coisa para entrar outra.`);
    }
    await this.pool.query(
      `INSERT INTO taste.user_items (user_id, item_id, rating, favorite, visibility)
            VALUES ($1, $2, $3, COALESCE($4, false), COALESCE($5, 'everyone'))
       ON CONFLICT (user_id, item_id) DO UPDATE SET
            rating = CASE WHEN $6 THEN $3 ELSE taste.user_items.rating END,
            favorite = COALESCE($4, taste.user_items.favorite),
            visibility = COALESCE($5, taste.user_items.visibility),
            updated_at = now()`,
      [userId, itemId, b.rating ?? null, b.favorite ?? null, b.visibility ?? null, b.rating !== undefined],
    );
  }

  async remove(userId: string, itemId: string) {
    await this.pool.query('DELETE FROM taste.user_items WHERE user_id = $1 AND item_id = $2', [userId, itemId]);
  }

  /**
   * Sugerir um item novo (nome, tipo, grupo). Fica "pending": só o autor o vê até a moderação aprovar.
   * Se já existe um igual (sem acentos/maiúsculas), devolve esse em vez de duplicar.
   */
  async suggest(userId: string, b: { name: string; kind: Kind; category: string; alcoholic?: boolean }) {
    const alcoholic = b.kind === 'bebida' && !!b.alcoholic;
    if (alcoholic && !(await this.isAdult(userId))) throw new BadRequestException('Bebidas alcoólicas só para maiores de 18 anos');
    const slug = `${b.kind}-${normalizeTag(b.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    if (slug.length < b.kind.length + 3) throw new BadRequestException('Dá um nome a sério ao item');

    const dup = await this.pool.query(
      `SELECT id, slug, name, kind, category, alcoholic, status, created_by FROM taste.items
        WHERE slug = $1 AND (status = 'curated' OR created_by = $2)`,
      [slug, userId],
    );
    if (dup.rows[0]) return itemOut(dup.rows[0], userId);

    // Já existe, mas pendente de outra pessoa: o mesmo nome fica ligado ao dela, esta cria o seu com sufixo.
    const taken = await this.pool.query('SELECT 1 FROM taste.items WHERE slug = $1', [slug]);
    const finalSlug = taken.rowCount ? `${slug}-${userId.slice(0, 6)}` : slug;
    const { rows } = await this.pool.query(
      `INSERT INTO taste.items (id, slug, name, kind, category, alcoholic, status, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
         RETURNING id, slug, name, kind, category, alcoholic, status, created_by`,
      [uuidv7(), finalSlug, b.name, b.kind, b.category, alcoholic, userId],
    );
    await this.pool.query('INSERT INTO taste.user_items (user_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, rows[0].id]);
    return itemOut(rows[0], userId);
  }

  /**
   * A geleira de outra pessoa, só com o que o espectador pode ver:
   * conta visível (público/seguidor, sem bloqueio), item "todos" ou "seguidores" (se segue) e álcool só para adultos.
   * Item "só eu" nunca sai daqui. O próprio dono vê tudo no /me.
   */
  async of(viewerId: string, username: string) {
    const { rows: owner } = await this.pool.query(
      `SELECT u.id, (${canView('u', '$2')}) AS can FROM identity.users u WHERE lower(u.username) = lower($1)`,
      [username, viewerId],
    );
    if (!owner[0] || !owner[0].can) throw new NotFoundException('Essa pessoa não existe');
    const adult = await this.isAdult(viewerId);
    const { rows } = await this.pool.query(
      `SELECT i.id, i.slug, i.name, i.kind, i.category, i.alcoholic, i.status, i.created_by, ui.rating, ui.favorite
         FROM taste.user_items ui JOIN taste.items i ON i.id = ui.item_id
        WHERE ui.user_id = $1 AND i.status = 'curated' AND ($3 OR NOT i.alcoholic)
          AND (ui.user_id = $2 OR ui.visibility = 'everyone'
               OR (ui.visibility = 'followers' AND EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $2 AND f.followee_id = ui.user_id)))
        ORDER BY ui.favorite DESC, ui.rating DESC NULLS LAST, ui.updated_at DESC`,
      [owner[0].id, viewerId, adult],
    );
    return rows.map((r) => ({ ...itemOut(r, viewerId), rating: r.rating as number | null, favorite: r.favorite as boolean }));
  }

  /** Quanto vale a minha geleira em Txills, por prateleira, com as joias e o nível. */
  async value(userId: string) {
    const adult = await this.isAdult(userId);
    const { rows } = await this.pool.query(
      `SELECT i.name, i.kind, ui.rating, ui.favorite,
              (SELECT count(*)::int FROM taste.user_items f WHERE f.item_id = i.id) AS fans
         FROM taste.user_items ui JOIN taste.items i ON i.id = ui.item_id
        WHERE ui.user_id = $1 AND i.status = 'curated' AND ($2 OR NOT i.alcoholic)`,
      [userId, adult],
    );
    const byKind: Record<Kind, { value: number; count: number }> = { vibe: { value: 0, count: 0 }, bebida: { value: 0, count: 0 }, comida: { value: 0, count: 0 }, sitio: { value: 0, count: 0 } };
    const items = rows.map((r) => ({ name: r.name as string, kind: r.kind as Kind, value: itemValue(r.kind, r.rating, r.favorite, r.fans) }));
    for (const i of items) {
      byKind[i.kind].value += i.value;
      byKind[i.kind].count += 1;
    }
    const sum = items.reduce((n, i) => n + i.value, 0);
    const fullShelves = KINDS.filter((k) => byKind[k].count >= 3).length;
    const bonusPct = fullShelves * 5;
    const total = Math.round(sum * (1 + bonusPct / 100));
    const idx = LEVELS.reduce((n, l, k) => (total >= l.at ? k : n), 0);
    const next = LEVELS[idx + 1] ?? null;
    return {
      total,
      bonusPct,
      byKind,
      jewels: [...items].sort((a, b) => b.value - a.value).slice(0, 3),
      level: { name: LEVELS[idx].name, from: LEVELS[idx].at, next: next && { name: next.name, at: next.at } },
    };
  }

  async settings(userId: string) {
    const { rows } = await this.pool.query('SELECT geleira_matching FROM identity.users WHERE id = $1', [userId]);
    return { matching: rows[0].geleira_matching as boolean };
  }
  async setSettings(userId: string, b: { matching?: boolean }) {
    await this.pool.query('UPDATE identity.users SET geleira_matching = COALESCE($2, geleira_matching) WHERE id = $1', [userId, b.matching ?? null]);
    return this.settings(userId);
  }

  /** Moderação: itens sugeridos à espera de decisão. */
  async pending() {
    const { rows } = await this.pool.query(
      `SELECT i.id, i.name, i.kind, i.category, i.alcoholic, i.created_at AS "createdAt", u.username AS "by"
         FROM taste.items i LEFT JOIN identity.users u ON u.id = i.created_by
        WHERE i.status = 'pending' ORDER BY i.created_at`,
    );
    return rows;
  }
  async decide(itemId: string, approve: boolean) {
    const r = await this.pool.query(`UPDATE taste.items SET status = $2 WHERE id = $1 AND status = 'pending'`, [itemId, approve ? 'curated' : 'rejected']);
    if (!r.rowCount) throw new NotFoundException('Esse item não está pendente');
  }
}

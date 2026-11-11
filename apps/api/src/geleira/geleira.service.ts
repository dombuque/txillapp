import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { ageOf } from '@txillapp/shared';
import { PG_POOL } from '../db/db.module';
import { normalizeTag } from '../common/hashtags';
import { uuidv7 } from '../common/uuid7';
import { NotificationsService } from '../notifications/notifications.service';
import { blockedBetween, canView } from '../social/visibility';

export const KINDS = ['vibe', 'bebida', 'comida', 'sitio'] as const;
export type Kind = (typeof KINDS)[number];
export type Visibility = 'everyone' | 'followers' | 'close_friends' | 'me';

/** Máximo de itens na geleira de cada pessoa. */
export const MAX_ITEMS = 200;
/** Idade a partir da qual existem bebidas alcoólicas. */
const ADULT = 18;

/** Letras sem acentos, minúsculas, para comparar nomes ("Pastéis de nata" = "pasteis de nata"). */
const fold = (s: string) => `translate(lower(${s}), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;

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
  slug: r.slug,
  name: r.name,
  kind: r.kind,
  category: r.category,
  alcoholic: r.alcoholic,
  // Item sugerido por mim que ainda ninguém aprovou: só eu o vejo.
  pending: r.status === 'pending' && r.created_by === viewer,
});

@Injectable()
export class GeleiraService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * O dono de uma geleira visto por quem pede: `can` (a conta é visível, sem bloqueio em nenhum sentido) e `shown`
   * (a visibilidade da geleira deixa: todos, seguidores, amigos próximos ou só o dono). Regra única de of/level/brindes.
   */
  private async owner(viewerId: string, username: string) {
    const { rows } = await this.pool.query(
      `SELECT u.id, (${canView('u', '$2')}) AS can, u.birth_date,
              (u.id = $2 OR u.geleira_visibility = 'everyone'
               OR (u.geleira_visibility = 'followers' AND EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $2 AND f.followee_id = u.id))
               OR (u.geleira_visibility = 'close_friends' AND EXISTS (SELECT 1 FROM social.close_friends cf WHERE cf.owner_id = u.id AND cf.friend_id = $2))) AS shown
         FROM identity.users u WHERE lower(u.username) = lower($1)`,
      [username, viewerId],
    );
    return rows[0] as { id: string; can: boolean; birth_date: string | null; shown: boolean } | undefined;
  }

  /** O dono de uma geleira que quem pede pode ver; senão 404 (não se distingue "escondida" de "não existe"). */
  private async visibleOwner(viewerId: string, username: string) {
    const o = await this.owner(viewerId, username);
    if (!o || !o.can || !o.shown) throw new NotFoundException('Sem geleira para mostrar');
    return o;
  }

  /**
   * Brindes contados de uma geleira: sem contas inativas nem quem tem bloqueio com o dono (a contagem bate com a lista
   * que o dono vê). `cheered`: se quem pede brindou.
   */
  private async cheersOf(ownerId: string, viewerId: string) {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS n, bool_or(c.user_id = $2) AS mine
         FROM taste.geleira_cheers c JOIN identity.users u ON u.id = c.user_id
        WHERE c.owner_id = $1 AND u.status = 'active' AND NOT ${blockedBetween('u.id', 'c.owner_id')}`,
      [ownerId, viewerId],
    );
    return { cheered: !!rows[0].mine, cheers: rows[0].n as number };
  }

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
    // `region`: do país onde a pessoa está (local), de qualquer sítio (global) ou de outro país (foreign). Sem país conhecido, tudo é global.
    const { rows } = await this.pool.query(
      `SELECT i.id, i.slug, i.name, i.kind, i.category, i.alcoholic, i.status, i.created_by,
              (SELECT count(*)::int FROM taste.user_items f WHERE f.item_id = i.id) AS fans,
              (m.user_id IS NOT NULL) AS mine, m.rating, COALESCE(m.favorite, false) AS favorite,
              CASE WHEN i.countries IS NULL OR vc.country IS NULL THEN 'global'
                   WHEN vc.country = ANY(i.countries) THEN 'local' ELSE 'foreign' END AS region
         FROM taste.items i
         LEFT JOIN taste.user_items m ON m.item_id = i.id AND m.user_id = $1
         LEFT JOIN identity.users vc ON vc.id = $1
        WHERE ${where}
        ORDER BY (CASE WHEN i.countries IS NOT NULL AND vc.country = ANY(i.countries) THEN 0 ELSE 1 END), fans DESC, i.name LIMIT 600`,
      params,
    );
    return rows.map((r) => ({ ...itemOut(r, userId), mine: r.mine as boolean, rating: r.rating as number | null, favorite: r.favorite as boolean, fans: r.fans as number, region: r.region as 'local' | 'global' | 'foreign' }));
  }

  /** A minha geleira completa, com visibilidade de cada item. */
  async mine(userId: string) {
    const adult = await this.isAdult(userId);
    const { rows } = await this.pool.query(
      `SELECT i.id, i.slug, i.name, i.kind, i.category, i.alcoholic, i.status, i.created_by,
              ui.rating, ui.favorite
         FROM taste.user_items ui JOIN taste.items i ON i.id = ui.item_id
        WHERE ui.user_id = $1 AND i.status <> 'rejected' AND ($2 OR NOT i.alcoholic)
        ORDER BY ui.favorite DESC, ui.rating DESC NULLS LAST, ui.updated_at DESC`,
      [userId, adult],
    );
    return rows.map((r) => ({ ...itemOut(r, userId), rating: r.rating as number | null, favorite: r.favorite as boolean }));
  }

  /** Guardar ou alterar um item da minha geleira (nota, favorito). Repetir o pedido dá o mesmo resultado. */
  async put(userId: string, itemId: string, b: { rating?: number | null; favorite?: boolean }) {
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
      `INSERT INTO taste.user_items (user_id, item_id, rating, favorite)
            VALUES ($1, $2, $3, COALESCE($4, false))
       ON CONFLICT (user_id, item_id) DO UPDATE SET
            rating = CASE WHEN $5 THEN $3 ELSE taste.user_items.rating END,
            favorite = COALESCE($4, taste.user_items.favorite),
            updated_at = now()`,
      [userId, itemId, b.rating ?? null, b.favorite ?? null, b.rating !== undefined],
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
   * A geleira de outra pessoa. Quem decide é o dono, para a geleira inteira: todos, seguidores, amigos próximos ou só ele.
   * Conta tem de estar visível (público/seguidor, sem bloqueio) e o álcool só sai para adultos. Se não pode ver, devolve vazio
   * (não se distingue "escondida" de "vazia", para ninguém a descobrir por tentativa).
   */
  async of(viewerId: string, username: string) {
    const o = await this.owner(viewerId, username);
    if (!o || !o.can) throw new NotFoundException('Essa pessoa não existe');
    if (!o.shown) return [];
    const adult = await this.isAdult(viewerId);
    const { rows } = await this.pool.query(
      `SELECT i.id, i.slug, i.name, i.kind, i.category, i.alcoholic, i.status, i.created_by, ui.rating, ui.favorite
         FROM taste.user_items ui JOIN taste.items i ON i.id = ui.item_id
        WHERE ui.user_id = $1 AND i.status = 'curated' AND ($2 OR NOT i.alcoholic)
        ORDER BY ui.favorite DESC, ui.rating DESC NULLS LAST, ui.updated_at DESC`,
      [o.id, adult],
    );
    return rows.map((r) => ({ ...itemOut(r, viewerId), rating: r.rating as number | null, favorite: r.favorite as boolean }));
  }

  /**
   * Nível da geleira de alguém: pontos (álcool e vibes de festa valem mais) e título em calão da malta. O título do topo
   * respeita a idade (madala só a partir dos 45), sem nunca devolver a data de nascimento. Só para quem pode ver a geleira.
   * Traz também os brindes à geleira (`cheers`) e se eu brindei (`cheered`).
   */
  async level(viewerId: string, username: string) {
    const o = await this.visibleOwner(viewerId, username);
    // O nível premeia quantidade, variedade e gostos avaliados (nunca o álcool nem os Txills). Só contam bebidas e comidas, que é o que a geleira mostra.
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE ui.favorite)::int AS fav,
              count(*) FILTER (WHERE ui.rating IS NOT NULL)::int AS rated,
              count(DISTINCT i.category)::int AS cats
         FROM taste.user_items ui JOIN taste.items i ON i.id = ui.item_id
        WHERE ui.user_id = $1 AND i.status = 'curated' AND i.kind IN ('bebida', 'comida')`,
      [o.id],
    );
    const { n, fav, rated, cats } = rows[0] as { n: number; fav: number; rated: number; cats: number };
    const points = n + fav + Math.floor(rated / 2) + cats;
    const steps = [1, 12, 30, 60];
    const byPoints = points <= 0 ? 0 : points >= steps[3] ? 4 : points >= steps[2] ? 3 : points >= steps[1] ? 2 : 1;
    // Os dois níveis de cima pedem substância: variedade (grupos diferentes) e gostos avaliados.
    const gate = cats >= 6 && rated >= 10 ? 4 : cats >= 4 && rated >= 5 ? 3 : 2;
    const level = Math.min(byPoints, gate);
    const held = level < byPoints;
    const age = o.birth_date ? Math.floor((Date.now() - new Date(o.birth_date).getTime()) / 31_557_600_000) : null;
    const top = age !== null && age >= 45 ? 'Madala da paulada' : age !== null && age >= 30 ? 'Mestre da paulada' : 'Lenda da paulada';
    const titles = ['Geleira seca', 'A txilar', 'Maningue abastecida', 'Paulada garantida', top];
    return {
      points,
      tasteContribution: points,
      txillContribution: 0,
      level,
      title: titles[level],
      toNext: level >= 4 ? null : held ? null : steps[level] - points,
      hint: held ? (level >= 2 ? `Para subir: mais variedade (${level === 2 ? 4 : 6} grupos diferentes) e gostos avaliados (${level === 2 ? 5 : 10})` : null) : null,
      nextTitle: level >= 4 ? null : level === 3 ? top : titles[level + 1],
      ...(await this.cheersOf(o.id, viewerId)),
    };
  }

  /**
   * Brindar a geleira de alguém (on) ou tirar o brinde. Só quem a pode ver; a própria não. Repetir dá o mesmo resultado.
   * O dono é avisado (na lista e no telemóvel) só da PRIMEIRA vez que cada pessoa brinda: tirar e voltar a pôr não avisa.
   */
  async cheer(viewerId: string, username: string, on: boolean) {
    const o = await this.visibleOwner(viewerId, username);
    if (o.id === viewerId) throw new BadRequestException('Não podes brindar a tua própria geleira');
    if (on) {
      await this.pool.query('INSERT INTO taste.geleira_cheers (owner_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [o.id, viewerId]);
      const first = await this.pool.query('INSERT INTO taste.geleira_cheer_notices (owner_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [o.id, viewerId]);
      if (first.rowCount) await this.notifications.notify({ userId: o.id, actorId: viewerId, kind: 'geleira_cheer' });
    } else {
      await this.pool.query('DELETE FROM taste.geleira_cheers WHERE owner_id = $1 AND user_id = $2', [o.id, viewerId]);
    }
    return this.cheersOf(o.id, viewerId);
  }

  /** Quem brindou a minha geleira, os mais recentes primeiro. Só o dono vê; sem contas inativas nem bloqueios. */
  async cheers(viewerId: string, username: string) {
    const me = await this.pool.query('SELECT 1 FROM identity.users WHERE id = $1 AND lower(username) = lower($2)', [viewerId, username]);
    if (!me.rowCount) throw new ForbiddenException('Só o dono vê quem brindou a geleira');
    const { rows } = await this.pool.query(
      `SELECT u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar, c.created_at
         FROM taste.geleira_cheers c JOIN identity.users u ON u.id = c.user_id
        WHERE c.owner_id = $1 AND u.status = 'active' AND NOT ${blockedBetween('u.id', 'c.owner_id')}
        ORDER BY c.created_at DESC LIMIT 200`,
      [viewerId],
    );
    return { items: rows.map((r) => ({ username: r.username as string, displayName: r.display_name as string, hasAvatar: !!r.has_avatar, at: r.created_at as Date })) };
  }

  async settings(userId: string) {
    const { rows } = await this.pool.query('SELECT geleira_matching, geleira_visibility FROM identity.users WHERE id = $1', [userId]);
    return { matching: rows[0].geleira_matching as boolean, visibility: rows[0].geleira_visibility as Visibility };
  }
  async setSettings(userId: string, b: { matching?: boolean; visibility?: Visibility }) {
    await this.pool.query(
      'UPDATE identity.users SET geleira_matching = COALESCE($2, geleira_matching), geleira_visibility = COALESCE($3, geleira_visibility) WHERE id = $1',
      [userId, b.matching ?? null, b.visibility ?? null],
    );
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

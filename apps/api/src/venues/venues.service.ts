import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { NotificationsService } from '../notifications/notifications.service';
import { MAX_AMOUNT, WalletService } from '../wallet/wallet.service';
import { TextFilter } from '../safety/text-filter.service';
import { blockedBetween } from '../social/visibility';
import { badge } from '../common/badge';

export const VENUE_KINDS = ['bar', 'restaurante', 'discoteca', 'cafe', 'hotel', 'evento', 'outro'] as const;
export type VenueKind = (typeof VENUE_KINDS)[number];
export const MANAGER_ROLES = ['admin', 'editor'] as const;
export type ManagerRole = (typeof MANAGER_ROLES)[number];
/** O que a pessoa é na página: dono, administrador (edita e gere gestores), editor (publica como o local) ou nada. */
export type VenueRole = 'owner' | ManagerRole | null;

/** Quantos locais cada pessoa pode criar (contra abusos), o intervalo entre check-ins e quantos gestores por página. */
const MAX_VENUES = 3;
const CHECKIN_GAP_HOURS = 6;
const MAX_MANAGERS = 20;

const slugOf = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

export interface VenueProfileInput {
  name?: string;
  kind?: VenueKind;
  city?: string | null;
  about?: string | null;
  address?: string | null;
  hours?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  website?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Aparecer no mapa e em "perto de mim" por distância (por omissão sim). */
  showOnMap?: boolean;
  avatarMediaId?: string | null;
  coverMediaId?: string | null;
  /** O local aceita pagamentos em Txills (dono e administradores). */
  acceptsTxills?: boolean;
}

const PAYMENTS_PAGE = 30;

/** A posição de um local é pública (é um sítio, não uma pessoa): guarda-se com 6 casas decimais (~10 cm). */
const coord6 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 1_000_000) / 1_000_000);

/**
 * Locais: bares, restaurantes, discotecas… Cada local é uma página (como no Facebook): tem dono e gestores, perfil
 * completo, seguidores, publicações feitas como o local, selo depois de verificado pela equipa e check-in por QR.
 * Só se mostram números de check-ins, nunca quem foi.
 *
 * Pagar com Txills (a moeda do Txillapp) nos locais. Acrescentos ao contrato:
 * - PATCH /venues/:slug aceita { acceptsTxills: boolean } (dono e administradores). O local devolve sempre
 *   `acceptsTxills: boolean` e, só para quem gere (dono, administradores e editores), `txillsBalance: number`.
 * - POST /venues/:slug/pay { amount: int 1..100000, note?: string <= 120, idempotencyKey: string 8..100 }
 *   (a chave também pode vir no cabeçalho Idempotency-Key) -> 201 { transactionId, balance, at (ISO, hora do servidor), replayed }.
 *   `balance` é o meu saldo depois de pagar. Local que não aceita Txills: 422. Saldo insuficiente: 422.
 *   Os gestores recebem a notificação 'venue_payment' (actor = quem pagou; data: { amount, venueName, venueSlug, note?, groupId?, groupName? }).
 * - GET /venues/:slug/payments?cursor=<id> (dono, administradores e editores; os outros 403) ->
 *   { items: [{ id, from: { username, displayName } | { group: { id, name } }, by: { username, displayName }, amount, note, at }],
 *     balance, nextCursor }. `by` é quem carregou no botão (no pagamento de um cofre, o administrador do grupo).
 * - Levantar os Txills de um local para dinheiro (cash-out) ainda não existe: fica para uma fase seguinte.
 */
/** O local está à vista de `viewer`: aprovado pela equipa, ou é dono / gestor / convidado a gerir (para o preparar enquanto está em análise). */
export const venueVisible = (v = 'v', viewer = '$1') =>
  `(${v}.review_status = 'approved' OR ${v}.owner_id = ${viewer} OR EXISTS (SELECT 1 FROM content.venue_managers vm WHERE vm.venue_id = ${v}.id AND vm.user_id = ${viewer}))`;

@Injectable()
export class VenuesService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly filter: TextFilter,
    private readonly notifications: NotificationsService,
    private readonly wallet: WalletService,
  ) {}

  private dto(r: Record<string, any>, viewerId: string) {
    const role = (r.owner_id === viewerId ? 'owner' : (r.role as ManagerRole | null) ?? null) as VenueRole;
    const canEdit = role === 'owner' || role === 'admin';
    return {
      id: r.id as string,
      slug: r.slug as string,
      name: r.name as string,
      kind: r.kind as VenueKind,
      city: (r.city as string | null) ?? null,
      about: (r.about as string | null) ?? null,
      address: (r.address as string | null) ?? null,
      hours: (r.hours as string | null) ?? null,
      phone: (r.phone as string | null) ?? null,
      whatsapp: (r.whatsapp as string | null) ?? null,
      website: (r.website as string | null) ?? null,
      avatarUrl: r.avatar_media_id ? `/api/v1/media/${r.avatar_media_id as string}` : null,
      coverUrl: r.cover_media_id ? `/api/v1/media/${r.cover_media_id as string}` : null,
      verified: !!r.verified,
      /** Aprovação pela equipa: 'pending' (em análise), 'approved' ou 'rejected'. Só quem gere vê o motivo da recusa. */
      reviewStatus: ((r.review_status as string | null) ?? 'approved') as 'pending' | 'approved' | 'rejected',
      reviewNote: role ? ((r.review_note as string | null) ?? null) : undefined,
      acceptsTxills: !!r.accepts_txills,
      /** Saldo de Txills do local: só quem o gere o vê. */
      txillsBalance: role ? Number(r.txills_balance ?? 0) : undefined,
      /** Aparece no mapa e em "perto de mim" (quem gere pode desligar). */
      showOnMap: r.show_on_map !== false,
      // Fora do mapa, a posição só a vê quem gere o local (para a poder acertar).
      lat: r.lat == null || (r.show_on_map === false && !role) ? null : Number(r.lat),
      lng: r.lng == null || (r.show_on_map === false && !role) ? null : Number(r.lng),
      checkins: Number(r.checkins ?? 0),
      checkinsToday: Number(r.checkins_today ?? 0),
      followers: Number(r.followers ?? 0),
      posts: Number(r.posts ?? 0),
      following: !!r.following,
      /** O que quem vê é nesta página. */
      role,
      /** `mine` fica por compatibilidade: dono ou gestor ativo. */
      mine: role !== null,
      canEdit,
      canPost: role !== null,
      /** Convite por aceitar para gerir esta página (com o papel proposto). */
      invite: (r.invite_role as ManagerRole | null) ?? null,
      // O código do QR só os gestores o veem (para imprimir).
      qrToken: role ? (r.check_token as string) : undefined,
      checkedIn: !!r.checked_in,
      owner: r.owner_username ? { username: r.owner_username as string, displayName: r.owner_display_name as string } : undefined,
      createdAt: r.created_at as string,
    };
  }

  /** $1 = quem vê; os outros parâmetros começam em $2. */
  private readonly SELECT = `
    SELECT v.*, ou.username AS owner_username, ou.display_name AS owner_display_name,
           (SELECT count(*) FROM content.checkins c WHERE c.venue_id = v.id) AS checkins,
           (SELECT count(*) FROM content.checkins c WHERE c.venue_id = v.id AND c.created_at > now() - interval '24 hours') AS checkins_today,
           (SELECT count(*) FROM content.venue_follows f WHERE f.venue_id = v.id) AS followers,
           (SELECT count(*) FROM content.posts p WHERE p.venue_id = v.id AND p.removed_at IS NULL) AS posts,
           EXISTS (SELECT 1 FROM content.venue_follows f WHERE f.venue_id = v.id AND f.user_id = $1) AS following,
           (SELECT m.role FROM content.venue_managers m WHERE m.venue_id = v.id AND m.user_id = $1 AND m.status = 'active') AS role,
           (SELECT m.role FROM content.venue_managers m WHERE m.venue_id = v.id AND m.user_id = $1 AND m.status = 'pending') AS invite_role,
           EXISTS (SELECT 1 FROM content.checkins c WHERE c.venue_id = v.id AND c.user_id = $1 AND c.created_at > now() - interval '${CHECKIN_GAP_HOURS} hours') AS checked_in,
           (SELECT a.balance FROM ledger.accounts a WHERE a.venue_id = v.id) AS txills_balance
      FROM content.venues v JOIN identity.users ou ON ou.id = v.owner_id AND ou.status <> 'deleted'`;

  /** O papel de uma pessoa numa página (dono, administrador, editor ou nada). */
  async roleOf(userId: string, venueId: string): Promise<VenueRole> {
    const r = (await this.pool.query(
      `SELECT CASE WHEN v.owner_id = $2 THEN 'owner' ELSE (SELECT m.role FROM content.venue_managers m WHERE m.venue_id = v.id AND m.user_id = $2 AND m.status = 'active') END AS role
         FROM content.venues v WHERE v.id = $1`,
      [venueId, userId],
    )).rows[0];
    return (r?.role as VenueRole | undefined) ?? null;
  }

  private async venueBySlug(slug: string): Promise<{ id: string; owner_id: string; name: string }> {
    const v = (await this.pool.query(
      `SELECT v.id, v.owner_id, v.name FROM content.venues v JOIN identity.users ou ON ou.id = v.owner_id AND ou.status <> 'deleted' WHERE v.slug = $1`,
      [slug.toLowerCase()],
    )).rows[0];
    if (!v) throw new NotFoundException('Local não encontrado');
    return v as { id: string; owner_id: string; name: string };
  }

  /** Garante que a pessoa pode fazer isto na página: `edit` (dono e administradores) ou `post` (também editores). */
  private async need(userId: string, slug: string, what: 'edit' | 'post') {
    const v = await this.venueBySlug(slug);
    const role = await this.roleOf(userId, v.id);
    const ok = what === 'post' ? role !== null : role === 'owner' || role === 'admin';
    if (!ok) throw new ForbiddenException(what === 'post' ? 'Só os gestores podem publicar como este local' : 'Só o dono e os administradores podem alterar este local');
    return { ...v, role: role as Exclude<VenueRole, null> };
  }

  private clean(b: VenueProfileInput) {
    this.filter.assertClean(b.name ?? '', b.city ?? '', b.about ?? '', b.address ?? '', b.hours ?? '');
    // A posição vai junta (as duas, ou as duas a null) e dentro dos limites.
    if ((b.lat === undefined) !== (b.lng === undefined) || (b.lat === null) !== (b.lng === null)) throw new BadRequestException('Manda a latitude e a longitude juntas');
    if (b.lat != null && b.lng != null) {
      if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng) || Math.abs(b.lat) > 90 || Math.abs(b.lng) > 180) throw new BadRequestException('Posição inválida');
      if (b.lat === 0 && b.lng === 0) throw new BadRequestException('Escolhe no mapa onde fica o local');
    }
    if (b.website && !/^https?:\/\/[^\s]{3,}$/i.test(b.website)) throw new BadRequestException('O site tem de começar por http:// ou https://');
    for (const k of ['phone', 'whatsapp'] as const) if (b[k] && !/^\+?[0-9 ()-]{6,30}$/.test(b[k]!)) throw new BadRequestException(`Confirma o número de ${k === 'phone' ? 'telefone' : 'WhatsApp'}`);
  }

  /** Uma foto própria, já carregada e livre (igual à foto de perfil). */
  private async assertImage(userId: string, mediaId: string) {
    const ok = await this.pool.query(
      `SELECT 1 FROM content.media_assets a WHERE a.id = $1 AND a.owner_id = $2 AND a.status = 'ready' AND a.mime LIKE 'image/%'
          AND NOT EXISTS (SELECT 1 FROM content.post_media pm WHERE pm.media_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM content.stories s WHERE s.media_id = a.id)`,
      [mediaId, userId],
    );
    if (!ok.rowCount) throw new BadRequestException('Foto inválida ou ainda não carregada');
  }

  async create(userId: string, b: VenueProfileInput & { name: string; kind: VenueKind }) {
    this.clean(b);
    const have = (await this.pool.query('SELECT count(*)::int AS n FROM content.venues WHERE owner_id = $1', [userId])).rows[0].n as number;
    if (have >= MAX_VENUES) throw new ForbiddenException(`Podes ter até ${MAX_VENUES} locais`);
    const base = slugOf(b.name);
    if (base.length < 3) throw new BadRequestException('Escolhe um nome com pelo menos 3 letras');
    let slug = base;
    for (let i = 2; (await this.pool.query('SELECT 1 FROM content.venues WHERE slug = $1', [slug])).rowCount; i++) slug = `${base.slice(0, 46)}-${i}`;
    const id = uuidv7();
    const country = (await this.pool.query('SELECT country FROM identity.users WHERE id = $1', [userId])).rows[0]?.country ?? null;
    await this.pool.query(
      `INSERT INTO content.venues (id, slug, name, kind, city, country, lat, lng, about, address, hours, phone, whatsapp, website, owner_id, check_token, show_on_map)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [id, slug, b.name.trim(), b.kind, b.city?.trim() || null, country, coord6(b.lat), coord6(b.lng), b.about?.trim() || null, b.address?.trim() || null, b.hours?.trim() || null, b.phone?.trim() || null, b.whatsapp?.trim() || null, b.website?.trim() || null, userId, randomBytes(12).toString('hex'), b.showOnMap ?? true],
    );
    return this.get(userId, slug);
  }

  /** O dono e os administradores editam o perfil da página (campos presentes; `null` limpa). */
  async update(userId: string, slug: string, b: VenueProfileInput) {
    const v = await this.need(userId, slug, 'edit');
    this.clean(b);
    if (b.avatarMediaId) await this.assertImage(userId, b.avatarMediaId);
    if (b.coverMediaId) await this.assertImage(userId, b.coverMediaId);
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    if (b.name !== undefined) { if (b.name.trim().length < 2) throw new BadRequestException('Escolhe um nome com pelo menos 2 letras'); set('name', b.name.trim()); }
    if (b.kind !== undefined) set('kind', b.kind);
    for (const k of ['city', 'about', 'address', 'hours', 'phone', 'whatsapp', 'website'] as const) if (b[k] !== undefined) set(k, b[k]?.trim() || null);
    if (b.lat !== undefined) set('lat', coord6(b.lat));
    if (b.lng !== undefined) set('lng', coord6(b.lng));
    if (b.showOnMap !== undefined) set('show_on_map', b.showOnMap);
    if (b.avatarMediaId !== undefined) set('avatar_media_id', b.avatarMediaId);
    if (b.coverMediaId !== undefined) set('cover_media_id', b.coverMediaId);
    if (b.acceptsTxills !== undefined) set('accepts_txills', b.acceptsTxills);
    if (sets.length) {
      // Recusado e corrigido pelo dono: volta para a fila da equipa.
      sets.push(`review_status = CASE WHEN review_status = 'rejected' THEN 'pending' ELSE review_status END`);
      vals.push(v.id);
      await this.pool.query(`UPDATE content.venues SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    }
    return this.get(userId, slug);
  }

  async get(viewerId: string, slug: string) {
    const r = (await this.pool.query(`${this.SELECT} WHERE v.slug = $2 AND ${venueVisible()}`, [viewerId, slug.toLowerCase()])).rows[0];
    if (!r) throw new NotFoundException('Local não encontrado');
    return this.dto(r, viewerId);
  }

  /** O local com este nome (usado pelo nome do sítio de uma publicação): o verificado primeiro. */
  async findByName(viewerId: string, name: string) {
    const r = (await this.pool.query(`${this.SELECT} WHERE lower(v.name) = lower($2) AND v.review_status = 'approved' ORDER BY v.verified DESC, v.created_at LIMIT 1`, [viewerId, name.trim().slice(0, 80)])).rows[0];
    return r ? this.dto(r, viewerId) : null;
  }

  /** As minhas páginas: as que criei e as que giro. */
  async mine(userId: string) {
    const rows = (await this.pool.query(
      `${this.SELECT} WHERE v.owner_id = $1 OR EXISTS (SELECT 1 FROM content.venue_managers m WHERE m.venue_id = v.id AND m.user_id = $1 AND m.status = 'active')
        ORDER BY (v.owner_id = $1) DESC, v.created_at DESC`,
      [userId],
    )).rows;
    return rows.map((r) => this.dto(r, userId));
  }

  /** Convites por aceitar para gerir páginas. */
  async invites(userId: string) {
    const rows = (await this.pool.query(`${this.SELECT} WHERE EXISTS (SELECT 1 FROM content.venue_managers m WHERE m.venue_id = v.id AND m.user_id = $1 AND m.status = 'pending') ORDER BY v.name`, [userId])).rows;
    return rows.map((r) => this.dto(r, userId));
  }

  /** Pesquisa de locais por nome ou cidade (no país de quem procura; os verificados e os mais seguidos primeiro). */
  async search(viewerId: string, term: string, limit = 10) {
    const t = term.trim().slice(0, 60);
    if (t.length < 2) return [];
    const like = `%${t.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = (await this.pool.query(
      `${this.SELECT} WHERE (v.name ILIKE $2 ESCAPE '\\' OR v.city ILIKE $2 ESCAPE '\\') AND v.review_status = 'approved'
        AND (v.country IS NULL OR v.country IS NOT DISTINCT FROM (SELECT country FROM identity.users WHERE id = $1))
        ORDER BY v.verified DESC, (SELECT count(*) FROM content.venue_follows f WHERE f.venue_id = v.id) DESC, v.name LIMIT $3`,
      [viewerId, like, limit],
    )).rows;
    return rows.map((r) => this.dto(r, viewerId));
  }

  /**
   * Descobrir: perto de mim (se der a posição) e os mais movimentados da semana, no meu país.
   * Os locais fora do mapa não entram em "perto de mim" (podem estar nos movimentados, sem posição).
   */
  async discover(viewerId: string, at: { lat: number; lng: number } | null) {
    const country = `(v.country IS NULL OR v.country IS NOT DISTINCT FROM (SELECT country FROM identity.users WHERE id = $1))`;
    const popular = (await this.pool.query(
      `${this.SELECT} WHERE ${country} AND v.review_status = 'approved'
        ORDER BY ((SELECT count(*) FROM content.checkins c WHERE c.venue_id = v.id AND c.created_at > now() - interval '7 days') * 3
                + (SELECT count(*) FROM content.venue_follows f WHERE f.venue_id = v.id)
                + (SELECT count(*) FROM content.posts p WHERE p.venue_id = v.id AND p.created_at > now() - interval '7 days') * 2) DESC,
                 v.verified DESC, v.created_at DESC
        LIMIT 12`,
      [viewerId],
    )).rows.map((r) => this.dto(r, viewerId));
    let nearby: ReturnType<VenuesService['dto']>[] = [];
    if (at) {
      // Distância aproximada (graus → km), chega para ordenar o que está a menos de ~25 km.
      nearby = (await this.pool.query(
        `${this.SELECT} WHERE v.lat IS NOT NULL AND v.lng IS NOT NULL AND v.review_status = 'approved' AND v.show_on_map
            AND abs(v.lat - $2) < 0.25 AND abs(v.lng - $3) < 0.25
          ORDER BY ((v.lat - $2) * (v.lat - $2) + (v.lng - $3) * (v.lng - $3) * cos(radians($2)) * cos(radians($2))) ASC LIMIT 12`,
        [viewerId, at.lat, at.lng],
      )).rows.map((r) => this.dto(r, viewerId));
    }
    return { nearby, popular };
  }

  /** Seguir / deixar de seguir a página. */
  async follow(userId: string, slug: string, on: boolean) {
    const v = await this.venueBySlug(slug);
    if (on) await this.pool.query('INSERT INTO content.venue_follows (venue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [v.id, userId]);
    else await this.pool.query('DELETE FROM content.venue_follows WHERE venue_id = $1 AND user_id = $2', [v.id, userId]);
    return this.get(userId, slug);
  }

  /** Os gestores da página (só para quem a gere): o dono primeiro, depois os ativos, depois os convites por aceitar. */
  async managers(userId: string, slug: string) {
    const v = await this.need(userId, slug, 'post');
    const { rows } = await this.pool.query(
      `SELECT u.username, u.display_name, u.verified, u.verified_tier, (u.avatar_media_id IS NOT NULL) AS has_avatar, m.role, m.status, m.created_at
         FROM content.venue_managers m JOIN identity.users u ON u.id = m.user_id
        WHERE m.venue_id = $1 AND u.status = 'active'
        ORDER BY (m.status = 'active') DESC, (m.role = 'admin') DESC, m.created_at`,
      [v.id],
    );
    const owner = (await this.pool.query('SELECT username, display_name, verified, verified_tier, (avatar_media_id IS NOT NULL) AS has_avatar FROM identity.users WHERE id = $1', [v.owner_id])).rows[0];
    return [
      { username: owner.username as string, displayName: owner.display_name as string, ...badge(owner.verified, owner.verified_tier), hasAvatar: !!owner.has_avatar, role: 'owner' as const, status: 'active' as const },
      ...rows.map((r) => ({ username: r.username as string, displayName: r.display_name as string, ...badge(r.verified, r.verified_tier), hasAvatar: !!r.has_avatar, role: r.role as ManagerRole, status: r.status as 'pending' | 'active', since: r.created_at as string })),
    ];
  }

  /** Convidar alguém para gerir a página (fica pendente até aceitar); repetir o convite muda o papel proposto. */
  async invite(userId: string, slug: string, username: string, role: ManagerRole) {
    const v = await this.need(userId, slug, 'edit');
    const who = (await this.pool.query(
      `SELECT u.id FROM identity.users u WHERE lower(u.username) = lower($1) AND u.status = 'active' AND NOT ${blockedBetween('u.id', '$2')}`,
      [username.replace(/^@/, ''), userId],
    )).rows[0];
    if (!who) throw new NotFoundException('Não encontrei essa pessoa');
    if (who.id === v.owner_id) throw new BadRequestException('O dono já gere a página');
    const n = (await this.pool.query('SELECT count(*)::int AS n FROM content.venue_managers WHERE venue_id = $1', [v.id])).rows[0].n as number;
    if (n >= MAX_MANAGERS) throw new ForbiddenException(`Até ${MAX_MANAGERS} gestores por local`);
    const r = await this.pool.query(
      `INSERT INTO content.venue_managers (venue_id, user_id, role, status, invited_by) VALUES ($1, $2, $3, 'pending', $4)
       ON CONFLICT (venue_id, user_id) DO UPDATE SET role = EXCLUDED.role WHERE content.venue_managers.status = 'pending'
       RETURNING status`,
      [v.id, who.id, role, userId],
    );
    if (!r.rowCount) throw new ConflictException('Essa pessoa já gere a página');
    void this.notifications.notify({ userId: who.id as string, actorId: userId, kind: 'venue_invite', data: { venueSlug: slug.toLowerCase(), venueName: v.name, role } });
    return this.managers(userId, slug);
  }

  /** Quem foi convidado aceita (passa a gestor) ou recusa (o convite desaparece). */
  async answerInvite(userId: string, slug: string, accept: boolean) {
    const v = await this.venueBySlug(slug);
    const r = accept
      ? await this.pool.query("UPDATE content.venue_managers SET status = 'active' WHERE venue_id = $1 AND user_id = $2 AND status = 'pending'", [v.id, userId])
      : await this.pool.query("DELETE FROM content.venue_managers WHERE venue_id = $1 AND user_id = $2 AND status = 'pending'", [v.id, userId]);
    if (!r.rowCount) throw new NotFoundException('Esse convite já não está de pé');
    return this.get(userId, slug);
  }

  /** Mudar o papel de um gestor (dono e administradores). */
  async setRole(userId: string, slug: string, username: string, role: ManagerRole) {
    const v = await this.need(userId, slug, 'edit');
    const r = await this.pool.query(
      'UPDATE content.venue_managers m SET role = $3 FROM identity.users u WHERE u.id = m.user_id AND m.venue_id = $1 AND lower(u.username) = lower($2)',
      [v.id, username.replace(/^@/, ''), role],
    );
    if (!r.rowCount) throw new NotFoundException('Essa pessoa não gere a página');
    return this.managers(userId, slug);
  }

  /** Tirar um gestor (dono e administradores), ou sair da página (o próprio). O dono não sai nem é tirado. */
  async removeManager(userId: string, slug: string, username: string) {
    const v = await this.venueBySlug(slug);
    const target = (await this.pool.query('SELECT id FROM identity.users WHERE lower(username) = lower($1)', [username.replace(/^@/, '')])).rows[0];
    if (!target) throw new NotFoundException('Não encontrei essa pessoa');
    if (target.id === v.owner_id) throw new BadRequestException('O dono não pode ser tirado da página');
    const role = await this.roleOf(userId, v.id);
    const self = target.id === userId;
    if (!self && role !== 'owner' && role !== 'admin') throw new ForbiddenException('Só o dono e os administradores podem tirar gestores');
    const r = await this.pool.query('DELETE FROM content.venue_managers WHERE venue_id = $1 AND user_id = $2', [v.id, target.id]);
    if (!r.rowCount) throw new NotFoundException('Essa pessoa não gere a página');
    return self ? { left: true } : this.managers(userId, slug);
  }

  /** Painel do gestor: seguidores, check-ins por dia (14 dias), publicações da página e reações a elas. */
  async insights(userId: string, slug: string) {
    const v = await this.need(userId, slug, 'post');
    const days = (await this.pool.query(
      `SELECT d::date AS day, (SELECT count(*) FROM content.checkins c WHERE c.venue_id = $1 AND c.created_at::date = d::date)::int AS checkins
         FROM generate_series(current_date - interval '13 days', current_date, interval '1 day') d ORDER BY d`,
      [v.id],
    )).rows.map((r) => ({ day: (r.day as Date).toISOString().slice(0, 10), checkins: r.checkins as number }));
    const t = (await this.pool.query(
      `SELECT (SELECT count(*) FROM content.venue_follows f WHERE f.venue_id = $1)::int AS followers,
              (SELECT count(*) FROM content.venue_follows f WHERE f.venue_id = $1 AND f.created_at > now() - interval '7 days')::int AS followers_week,
              (SELECT count(*) FROM content.checkins c WHERE c.venue_id = $1)::int AS checkins,
              (SELECT count(*) FROM content.checkins c WHERE c.venue_id = $1 AND c.created_at > now() - interval '7 days')::int AS checkins_week,
              (SELECT count(DISTINCT c.user_id) FROM content.checkins c WHERE c.venue_id = $1 AND c.created_at > now() - interval '30 days')::int AS people_month,
              (SELECT count(*) FROM content.posts p WHERE p.venue_id = $1 AND p.removed_at IS NULL)::int AS posts,
              (SELECT count(*) FROM content.cheers ch JOIN content.posts p ON p.id = ch.post_id WHERE p.venue_id = $1)::int AS cheers,
              (SELECT count(*) FROM content.comments cm JOIN content.posts p ON p.id = cm.post_id WHERE p.venue_id = $1)::int AS comments,
              (SELECT count(*) FROM content.posts p WHERE p.location_label IS NOT NULL AND lower(p.location_label) = lower((SELECT name FROM content.venues WHERE id = $1)) AND p.removed_at IS NULL)::int AS mentions`,
      [v.id],
    )).rows[0];
    return {
      followers: t.followers as number, followersWeek: t.followers_week as number,
      checkins: t.checkins as number, checkinsWeek: t.checkins_week as number, peopleMonth: t.people_month as number,
      posts: t.posts as number, cheers: t.cheers as number, comments: t.comments as number, mentions: t.mentions as number,
      days,
    };
  }

  /** Check-in: a ligação do QR leva o código do local. Um por pessoa, de 6 em 6 horas. */
  async checkin(userId: string, slug: string, token: string) {
    const v = (await this.pool.query("SELECT id, check_token FROM content.venues WHERE slug = $1 AND review_status = 'approved'", [slug.toLowerCase()])).rows[0];
    if (!v) throw new NotFoundException('Local não encontrado');
    const a = Buffer.from(String(v.check_token));
    const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('Este QR não é deste local. Lê o QR que está no local.');
    const recent = await this.pool.query(`SELECT 1 FROM content.checkins WHERE venue_id = $1 AND user_id = $2 AND created_at > now() - interval '${CHECKIN_GAP_HOURS} hours'`, [v.id, userId]);
    if (recent.rowCount) throw new ConflictException('Já fizeste check-in aqui há pouco');
    const day = (await this.pool.query("SELECT count(*)::int AS n FROM content.checkins WHERE user_id = $1 AND created_at > now() - interval '24 hours'", [userId])).rows[0].n as number;
    if (day >= 12) throw new HttpException('Muitos check-ins hoje. Tenta amanhã.', HttpStatus.TOO_MANY_REQUESTS);
    await this.pool.query('INSERT INTO content.checkins (id, venue_id, user_id) VALUES ($1, $2, $3)', [uuidv7(), v.id, userId]);
    return this.get(userId, slug);
  }

  /** A equipa verifica (ou tira o selo a) um local; fica no registo de auditoria. */
  async setVerified(actorId: string, slug: string, verified: boolean) {
    const r = await this.pool.query('UPDATE content.venues SET verified = $2 WHERE slug = $1 RETURNING id', [slug.toLowerCase(), verified]);
    if (!r.rowCount) throw new NotFoundException('Local não encontrado');
    await this.pool.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), actorId, verified ? 'moderation.venue_verified' : 'moderation.venue_unverified', `venue:${r.rows[0].id as string}`, { slug }]);
    return { slug, verified };
  }

  /**
   * A equipa aprova ou recusa um local (com motivo, que o dono vê). Aprovar torna-o público; recusar esconde-o
   * (o dono pode corrigir e volta à fila). O dono recebe uma notificação. Fica no registo de auditoria.
   */
  async review(actorId: string, slug: string, decision: 'approved' | 'rejected', note?: string) {
    const why = decision === 'rejected' ? note?.trim() || null : null;
    const r = await this.pool.query(
      `UPDATE content.venues SET review_status = $2, review_note = $3, reviewed_at = now(), reviewed_by = $4 WHERE slug = $1 RETURNING id, owner_id, name`,
      [slug.toLowerCase(), decision, why, actorId],
    );
    if (!r.rowCount) throw new NotFoundException('Local não encontrado');
    const v = r.rows[0];
    await this.pool.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), actorId, decision === 'approved' ? 'moderation.venue_approved' : 'moderation.venue_rejected', `venue:${v.id as string}`, { slug, note: why }]);
    await this.notifications.notify({ userId: v.owner_id as string, actorId, kind: 'venue_review', data: { venueSlug: slug.toLowerCase(), venueName: v.name, decision, note: why } });
    return { slug: slug.toLowerCase(), reviewStatus: decision };
  }

  /** Para a equipa: os locais. `pending`: à espera de aprovação (os mais antigos primeiro). `unverified`: aprovados sem selo. */
  async adminList(filter: 'pending' | 'unverified' | 'all') {
    const { rows } = await this.pool.query(
      `SELECT v.slug, v.name, v.kind, v.city, v.address, v.about, v.phone, v.website, v.verified, v.created_at, v.review_status, v.review_note, u.username AS owner,
              (SELECT count(*) FROM content.checkins c WHERE c.venue_id = v.id)::int AS checkins,
              (SELECT count(*) FROM content.venue_follows f WHERE f.venue_id = v.id)::int AS followers
         FROM content.venues v JOIN identity.users u ON u.id = v.owner_id
        WHERE ($1 = 'all' OR ($1 = 'pending' AND v.review_status = 'pending') OR ($1 = 'unverified' AND v.review_status = 'approved' AND NOT v.verified))
        ORDER BY CASE WHEN $1 = 'pending' THEN v.created_at END ASC, v.created_at DESC LIMIT 200`,
      [filter],
    );
    return rows.map((r) => ({ slug: r.slug as string, name: r.name as string, kind: r.kind as string, city: (r.city as string | null) ?? null, verified: !!r.verified, reviewStatus: r.review_status as string, reviewNote: (r.review_note as string | null) ?? null, address: (r.address as string | null) ?? null, about: (r.about as string | null) ?? null, phone: (r.phone as string | null) ?? null, website: (r.website as string | null) ?? null, owner: r.owner as string, checkins: r.checkins as number, followers: r.followers as number, createdAt: r.created_at as string }));
  }

  /** O dono ou um administrador muda o QR (se ele andou a circular fora do local). */
  async rotateToken(userId: string, slug: string) {
    const v = await this.need(userId, slug, 'edit');
    await this.pool.query('UPDATE content.venues SET check_token = $2 WHERE id = $1', [v.id, randomBytes(12).toString('hex')]);
    return this.get(userId, slug);
  }

  /* ───────────── pagar com Txills ───────────── */

  /** O local para receber um pagamento (404 se não existe, 422 se não aceita Txills). */
  async payableVenue(slug: string) {
    const v = (await this.pool.query(
      `SELECT v.id, v.slug, v.name, v.accepts_txills, v.review_status FROM content.venues v JOIN identity.users ou ON ou.id = v.owner_id AND ou.status <> 'deleted' WHERE v.slug = $1`,
      [slug.toLowerCase()],
    )).rows[0];
    if (!v) throw new NotFoundException('Local não encontrado');
    if (v.review_status !== 'approved') throw new UnprocessableEntityException('Este local ainda está em análise pela equipa do Txillapp');
    if (!v.accepts_txills) throw new UnprocessableEntityException('Este local ainda não aceita Txills');
    return { id: v.id as string, slug: v.slug as string, name: v.name as string };
  }

  /** Avisa quem gere o local (dono e gestores ativos) de que recebeu Txills. */
  async notifyPayment(venueId: string, actorId: string, data: Record<string, unknown>) {
    const { rows } = await this.pool.query(
      `SELECT owner_id AS id FROM content.venues WHERE id = $1
       UNION SELECT user_id FROM content.venue_managers WHERE venue_id = $1 AND status = 'active'`,
      [venueId],
    );
    await Promise.all(rows.map((r) => this.notifications.notify({ userId: r.id as string, actorId, kind: 'venue_payment', data })));
  }

  /** Qualquer pessoa paga ao local com Txills da sua carteira. */
  async pay(userId: string, slug: string, amount: number, note: string | undefined, key: string) {
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) throw new UnprocessableEntityException(`Montante deve ser inteiro entre 1 e ${MAX_AMOUNT}`);
    const cleanNote = note?.trim() || null;
    if (cleanNote) this.filter.assertClean(cleanNote);
    const v = await this.payableVenue(slug);
    const from = await this.wallet.ensureWallet(userId);
    const to = await this.wallet.ensureVenueWallet(v.id);
    // Ordem dos bloqueios: carteira da pessoa, depois a do local (ver MoveParams).
    const r = await this.wallet.move({
      type: 'venue_payment', actorId: userId, idempotencyKey: `venue_payment:${v.id}:${key}`,
      lock: [from, to], legs: [[from, -amount], [to, amount]],
      metadata: { venueId: v.id, venueName: v.name, payerId: userId, amount, note: cleanNote },
    });
    if (!r.replayed) await this.notifyPayment(v.id, userId, { venueSlug: v.slug, venueName: v.name, amount, note: cleanNote });
    const x = (await this.pool.query('SELECT a.balance, t.created_at FROM ledger.accounts a, ledger.transactions t WHERE a.id = $1 AND t.id = $2', [from, r.transactionId])).rows[0];
    return { transactionId: r.transactionId, balance: Number(x.balance), at: (x.created_at as Date).toISOString(), replayed: r.replayed };
  }

  /** Os pagamentos recebidos pelo local (só quem o gere), os mais recentes primeiro. */
  async payments(userId: string, slug: string, cursor?: string) {
    if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new BadRequestException('cursor inválido');
    const v = await this.venueBySlug(slug);
    if (!(await this.roleOf(userId, v.id))) throw new ForbiddenException('Só quem gere o local vê os pagamentos');
    const acc = (await this.pool.query('SELECT id, balance FROM ledger.accounts WHERE venue_id = $1', [v.id])).rows[0];
    if (!acc) return { items: [], balance: 0, nextCursor: null };
    const { rows } = await this.pool.query(
      `SELECT t.id, t.created_at, t.metadata, e.amount,
              pu.username AS payer_username, pu.display_name AS payer_name, pu.verified AS payer_verified, pu.verified_tier AS payer_tier,
              au.username AS actor_username, au.display_name AS actor_name, au.verified AS actor_verified, au.verified_tier AS actor_tier,
              g.name AS group_name
         FROM ledger.entries e
         JOIN ledger.transactions t ON t.id = e.transaction_id
         JOIN identity.users au ON au.id = t.actor_id
         LEFT JOIN identity.users pu ON pu.id::text = t.metadata->>'payerId'
         LEFT JOIN social.groups g ON g.id::text = t.metadata->>'groupId'
        WHERE e.account_id = $1 AND t.type = 'venue_payment' AND e.amount > 0 AND ($2::uuid IS NULL OR t.id < $2)
        ORDER BY t.id DESC LIMIT $3`,
      [acc.id, cursor ?? null, PAYMENTS_PAGE + 1],
    );
    const page = rows.slice(0, PAYMENTS_PAGE);
    return {
      items: page.map((r) => {
        const m = (r.metadata ?? {}) as Record<string, unknown>;
        const by = { username: r.actor_username as string, displayName: r.actor_name as string, ...badge(r.actor_verified, r.actor_tier) };
        const from = m.groupId
          ? { group: { id: String(m.groupId), name: (r.group_name as string | null) ?? String(m.groupName ?? 'Grupo') } }
          : r.payer_username ? { username: r.payer_username as string, displayName: r.payer_name as string, ...badge(r.payer_verified, r.payer_tier) } : by;
        return { id: r.id as string, from, by, amount: Number(r.amount), note: (m.note as string | null) ?? null, at: r.created_at as string };
      }),
      balance: Number(acc.balance),
      nextCursor: rows.length > PAYMENTS_PAGE ? (page[page.length - 1].id as string) : null,
    };
  }
}

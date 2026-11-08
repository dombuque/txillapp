import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { NotificationsService } from '../notifications/notifications.service';
import { TextFilter } from '../safety/text-filter.service';
import { blockedBetween } from '../social/visibility';

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
  avatarMediaId?: string | null;
  coverMediaId?: string | null;
}

/**
 * Locais: bares, restaurantes, discotecas… Cada local é uma página (como no Facebook): tem dono e gestores, perfil
 * completo, seguidores, publicações feitas como o local, selo depois de verificado pela equipa e check-in por QR.
 * Só se mostram números de check-ins, nunca quem foi.
 */
@Injectable()
export class VenuesService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly filter: TextFilter,
    private readonly notifications: NotificationsService,
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
      lat: (r.lat as number | null) ?? null,
      lng: (r.lng as number | null) ?? null,
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
           EXISTS (SELECT 1 FROM content.checkins c WHERE c.venue_id = v.id AND c.user_id = $1 AND c.created_at > now() - interval '${CHECKIN_GAP_HOURS} hours') AS checked_in
      FROM content.venues v JOIN identity.users ou ON ou.id = v.owner_id`;

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
    const v = (await this.pool.query('SELECT id, owner_id, name FROM content.venues WHERE slug = $1', [slug.toLowerCase()])).rows[0];
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
    const q = (n: number | null | undefined) => (n == null ? null : Math.round(n * 1000) / 1000);
    await this.pool.query(
      `INSERT INTO content.venues (id, slug, name, kind, city, country, lat, lng, about, address, hours, phone, whatsapp, website, owner_id, check_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [id, slug, b.name.trim(), b.kind, b.city?.trim() || null, country, q(b.lat), q(b.lng), b.about?.trim() || null, b.address?.trim() || null, b.hours?.trim() || null, b.phone?.trim() || null, b.whatsapp?.trim() || null, b.website?.trim() || null, userId, randomBytes(12).toString('hex')],
    );
    return this.get(userId, slug);
  }

  /** O dono e os administradores editam o perfil da página (campos presentes; `null` limpa). */
  async update(userId: string, slug: string, b: VenueProfileInput) {
    const v = await this.need(userId, slug, 'edit');
    this.clean(b);
    if (b.avatarMediaId) await this.assertImage(userId, b.avatarMediaId);
    if (b.coverMediaId) await this.assertImage(userId, b.coverMediaId);
    const q = (n: number | null | undefined) => (n == null ? null : Math.round(n * 1000) / 1000);
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    if (b.name !== undefined) { if (b.name.trim().length < 2) throw new BadRequestException('Escolhe um nome com pelo menos 2 letras'); set('name', b.name.trim()); }
    if (b.kind !== undefined) set('kind', b.kind);
    for (const k of ['city', 'about', 'address', 'hours', 'phone', 'whatsapp', 'website'] as const) if (b[k] !== undefined) set(k, b[k]?.trim() || null);
    if (b.lat !== undefined) set('lat', q(b.lat));
    if (b.lng !== undefined) set('lng', q(b.lng));
    if (b.avatarMediaId !== undefined) set('avatar_media_id', b.avatarMediaId);
    if (b.coverMediaId !== undefined) set('cover_media_id', b.coverMediaId);
    if (sets.length) {
      vals.push(v.id);
      await this.pool.query(`UPDATE content.venues SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    }
    return this.get(userId, slug);
  }

  async get(viewerId: string, slug: string) {
    const r = (await this.pool.query(`${this.SELECT} WHERE v.slug = $2`, [viewerId, slug.toLowerCase()])).rows[0];
    if (!r) throw new NotFoundException('Local não encontrado');
    return this.dto(r, viewerId);
  }

  /** O local com este nome (usado pelo nome do sítio de uma publicação): o verificado primeiro. */
  async findByName(viewerId: string, name: string) {
    const r = (await this.pool.query(`${this.SELECT} WHERE lower(v.name) = lower($2) ORDER BY v.verified DESC, v.created_at LIMIT 1`, [viewerId, name.trim().slice(0, 80)])).rows[0];
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
      `${this.SELECT} WHERE (v.name ILIKE $2 ESCAPE '\\' OR v.city ILIKE $2 ESCAPE '\\')
        AND (v.country IS NULL OR v.country IS NOT DISTINCT FROM (SELECT country FROM identity.users WHERE id = $1))
        ORDER BY v.verified DESC, (SELECT count(*) FROM content.venue_follows f WHERE f.venue_id = v.id) DESC, v.name LIMIT $3`,
      [viewerId, like, limit],
    )).rows;
    return rows.map((r) => this.dto(r, viewerId));
  }

  /** Descobrir: perto de mim (se der a posição) e os mais movimentados da semana, no meu país. */
  async discover(viewerId: string, at: { lat: number; lng: number } | null) {
    const country = `(v.country IS NULL OR v.country IS NOT DISTINCT FROM (SELECT country FROM identity.users WHERE id = $1))`;
    const popular = (await this.pool.query(
      `${this.SELECT} WHERE ${country}
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
        `${this.SELECT} WHERE v.lat IS NOT NULL AND v.lng IS NOT NULL
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
      `SELECT u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar, m.role, m.status, m.created_at
         FROM content.venue_managers m JOIN identity.users u ON u.id = m.user_id
        WHERE m.venue_id = $1 AND u.status = 'active'
        ORDER BY (m.status = 'active') DESC, (m.role = 'admin') DESC, m.created_at`,
      [v.id],
    );
    const owner = (await this.pool.query('SELECT username, display_name, (avatar_media_id IS NOT NULL) AS has_avatar FROM identity.users WHERE id = $1', [v.owner_id])).rows[0];
    return [
      { username: owner.username as string, displayName: owner.display_name as string, hasAvatar: !!owner.has_avatar, role: 'owner' as const, status: 'active' as const },
      ...rows.map((r) => ({ username: r.username as string, displayName: r.display_name as string, hasAvatar: !!r.has_avatar, role: r.role as ManagerRole, status: r.status as 'pending' | 'active', since: r.created_at as string })),
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
    const v = (await this.pool.query('SELECT id, check_token FROM content.venues WHERE slug = $1', [slug.toLowerCase()])).rows[0];
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

  /** Para a equipa: os locais, os por verificar primeiro. */
  async adminList(filter: 'pending' | 'all') {
    const { rows } = await this.pool.query(
      `SELECT v.slug, v.name, v.kind, v.city, v.verified, v.created_at, u.username AS owner,
              (SELECT count(*) FROM content.checkins c WHERE c.venue_id = v.id)::int AS checkins,
              (SELECT count(*) FROM content.venue_follows f WHERE f.venue_id = v.id)::int AS followers
         FROM content.venues v JOIN identity.users u ON u.id = v.owner_id
        WHERE ($1 = 'all' OR NOT v.verified)
        ORDER BY v.verified ASC, v.created_at DESC LIMIT 200`,
      [filter],
    );
    return rows.map((r) => ({ slug: r.slug as string, name: r.name as string, kind: r.kind as string, city: (r.city as string | null) ?? null, verified: !!r.verified, owner: r.owner as string, checkins: r.checkins as number, followers: r.followers as number, createdAt: r.created_at as string }));
  }

  /** O dono ou um administrador muda o QR (se ele andou a circular fora do local). */
  async rotateToken(userId: string, slug: string) {
    const v = await this.need(userId, slug, 'edit');
    await this.pool.query('UPDATE content.venues SET check_token = $2 WHERE id = $1', [v.id, randomBytes(12).toString('hex')]);
    return this.get(userId, slug);
  }
}

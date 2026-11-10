import { BadRequestException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { adminBlocked } from '../groups/group-access';
import { blockedBetween, canView } from '../social/visibility';
import { eventEnd } from './events.service';
import { agoLabel, distKm, inBox, km1, snapToCell } from './geo-sql';
import { SchemaProbe } from './schema-probe';

export const NEARBY_KINDS = ['venues', 'events', 'posts', 'groups', 'people'] as const;
export type NearbyKind = (typeof NEARBY_KINDS)[number];
export const NEARBY_WHEN = ['now', 'today', 'week'] as const;
export type NearbyWhen = (typeof NEARBY_WHEN)[number];
export const NEARBY_VISIBILITY = ['off', 'mutual', 'following'] as const;
export type NearbyVisibility = (typeof NEARBY_VISIBILITY)[number];

/** Quanto tempo a presença no mapa conta (e depois é apagada). */
const PRESENCE_HOURS = 3;
/** No máximo uma actualização da presença por pessoa a cada 50 segundos (~1 por minuto). */
const PRESENCE_GAP_S = 50;
const LIMITS = { venues: 60, events: 40, posts: 60, groups: 30, people: 60 } as const;

/** Quem pede, com a posição JÁ arredondada (~1 km). Nunca se guarda nem se escreve no registo. */
export interface Center {
  lat: number;
  lng: number;
}

const media = (id: unknown) => (id ? `/api/v1/media/${id as string}` : null);
const ADULT_SQL = (u: string) => `(${u}.birth_date IS NOT NULL AND ${u}.birth_date <= (current_date - interval '18 years'))`;
/** Locais do país onde o espectador está, ou sem país. */
// Só locais aprovados pela equipa (os que estão em análise não aparecem no mapa) e do país de quem vê.
const VENUE_COUNTRY = `(v.review_status = 'approved' AND (v.country IS NULL OR v.country IS NOT DISTINCT FROM (SELECT vc.country FROM identity.users vc WHERE vc.id = $1)))`;

/**
 * "À tua volta": locais, eventos, publicações recentes, TxillGroups públicos e a malta (quem quiser aparecer),
 * num raio de 5 a 30 km. A posição de quem pede chega já arredondada e só vive dentro do pedido.
 */
@Injectable()
export class NearbyService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Nearby');
  private sweeper?: NodeJS.Timeout;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly probe: SchemaProbe,
  ) {}

  onModuleInit() {
    if (this.config.NODE_ENV === 'test') return;
    this.sweeper = setInterval(() => void this.sweep().catch((e) => this.log.warn(`falha na varredura da presença: ${(e as Error).message}`)), 10 * 60_000);
    this.sweeper.unref();
  }

  onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  /** Apaga as presenças com mais de 3 horas. */
  async sweep() {
    const r = await this.pool.query(`DELETE FROM nearby.presence WHERE updated_at < now() - interval '${PRESENCE_HOURS} hours'`);
    return r.rowCount ?? 0;
  }

  async around(viewerId: string, c: Center, radiusKm: number, kinds: Set<NearbyKind>, when: NearbyWhen) {
    const p = [viewerId, c.lat, c.lng, radiusKm];
    const [venues, events, posts, groups, people] = await Promise.all([
      kinds.has('venues') ? this.venues(p) : [],
      kinds.has('events') ? this.events(p, when) : [],
      kinds.has('posts') ? this.posts(p) : [],
      kinds.has('groups') ? this.groups(p) : [],
      kinds.has('people') ? this.people(p) : [],
    ]);
    return { center: { lat: c.lat, lng: c.lng }, radiusKm, venues, events, posts, groups, people };
  }

  private async venues(p: unknown[], search = false) {
    const { accepts } = await this.probe.bits();
    const { rows } = await this.pool.query(
      `SELECT * FROM (
         SELECT v.slug, v.name, v.kind, v.avatar_media_id, v.verified, v.lat, v.lng, ${accepts ? 'v.accepts_txills' : 'NULL::boolean'} AS accepts_txills,
                ${distKm('v.lat', 'v.lng')} AS d,
                (SELECT count(*) FROM content.checkins ch WHERE ch.venue_id = v.id AND ch.created_at > now() - interval '24 hours')::int AS checkins_today,
                (SELECT count(*) FROM content.venue_follows f WHERE f.venue_id = v.id)::int AS followers
           FROM content.venues v
          WHERE v.lat IS NOT NULL AND v.lng IS NOT NULL AND ${inBox('v.lat', 'v.lng', '$4')} AND ${VENUE_COUNTRY}
            AND EXISTS (SELECT 1 FROM identity.users ou WHERE ou.id = v.owner_id AND ou.status <> 'deleted')
            ${search ? `AND (v.name ILIKE $5 ESCAPE '\\' OR v.city ILIKE $5 ESCAPE '\\')` : ''}
       ) x WHERE x.d <= $4::float8 ORDER BY x.d, x.verified DESC, x.slug LIMIT ${LIMITS.venues}`,
      p,
    );
    return rows.map((r) => ({
      slug: r.slug as string,
      name: r.name as string,
      kind: r.kind as string,
      avatarUrl: media(r.avatar_media_id),
      verified: !!r.verified,
      ...(r.accepts_txills == null ? {} : { acceptsTxills: !!r.accepts_txills }),
      lat: Number(r.lat),
      lng: Number(r.lng),
      distanceKm: km1(r.d),
      checkinsToday: Number(r.checkins_today),
      followers: Number(r.followers),
    }));
  }

  private async events(p: unknown[], when: NearbyWhen) {
    const end = eventEnd();
    const window =
      when === 'now'
        ? `e.starts_at <= now() AND ${end} > now()`
        : when === 'today'
          ? `${end} > now() AND e.starts_at < ((date_trunc('day', now() AT TIME ZONE 'Africa/Maputo') + interval '1 day') AT TIME ZONE 'Africa/Maputo')`
          : `${end} > now() AND e.starts_at < now() + interval '7 days'`;
    const { rows } = await this.pool.query(
      `SELECT * FROM (
         SELECT e.id, e.title, e.starts_at, e.ends_at, e.cover_media_id, v.slug, v.name, v.lat, v.lng, ${distKm('v.lat', 'v.lng')} AS d,
                (SELECT count(*) FROM content.venue_event_interest i WHERE i.event_id = e.id)::int AS interested
           FROM content.venue_events e JOIN content.venues v ON v.id = e.venue_id
          WHERE e.cancelled_at IS NULL AND ${window}
            AND v.lat IS NOT NULL AND v.lng IS NOT NULL AND ${inBox('v.lat', 'v.lng', '$4')} AND ${VENUE_COUNTRY}
       ) x WHERE x.d <= $4::float8 ORDER BY x.d, x.starts_at, x.id LIMIT ${LIMITS.events}`,
      p,
    );
    return rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      startsAt: new Date(r.starts_at as string).toISOString(),
      endsAt: r.ends_at ? new Date(r.ends_at as string).toISOString() : null,
      coverUrl: media(r.cover_media_id),
      venue: { slug: r.slug as string, name: r.name as string, lat: Number(r.lat), lng: Number(r.lng) },
      distanceKm: km1(r.d),
      interested: Number(r.interested),
    }));
  }

  /**
   * Publicações das últimas 48 horas com a posição do sítio (que só os adultos guardam), que o espectador pode ver,
   * sem bloqueios, com foto ou vídeo, no máximo 3 por pessoa.
   */
  private async posts(p: unknown[]) {
    const { rows } = await this.pool.query(
      `SELECT * FROM (
         SELECT x.*, row_number() OVER (PARTITION BY x.author_id ORDER BY x.created_at DESC) AS nth FROM (
           SELECT p.id, p.short_code, p.location_label, p.location_lat, p.location_lng, p.created_at, p.author_id, u.username, u.display_name,
                  ${distKm('p.location_lat', 'p.location_lng')} AS d,
                  fm.media_id AS first_media, (fm.mime LIKE 'video/%') AS is_video
             FROM content.posts p
             JOIN identity.users u ON u.id = p.author_id
             JOIN LATERAL (SELECT pm.media_id, ma.mime FROM content.post_media pm JOIN content.media_assets ma ON ma.id = pm.media_id
                            WHERE pm.post_id = p.id ORDER BY pm.position LIMIT 1) fm ON true
            WHERE p.removed_at IS NULL AND p.kind = 'post' AND p.created_at > now() - interval '48 hours'
              AND p.location_lat IS NOT NULL AND p.location_lng IS NOT NULL AND ${inBox('p.location_lat', 'p.location_lng', '$4')}
              AND (${ADULT_SQL('u')} OR p.author_id = $1)
              AND ${canView('u')}
         ) x WHERE x.d <= $4::float8
       ) y WHERE y.nth <= 3 ORDER BY y.d, y.created_at DESC LIMIT ${LIMITS.posts}`,
      p,
    );
    return rows.map((r) => ({
      id: r.id as string,
      code: r.short_code as string,
      thumbUrl: r.is_video ? `/api/v1/media/${r.first_media as string}?poster=1` : `/api/v1/media/${r.first_media as string}`,
      kind: (r.is_video ? 'video' : 'photo') as 'photo' | 'video',
      locationLabel: (r.location_label as string | null) ?? null,
      lat: Number(r.location_lat),
      lng: Number(r.location_lng),
      distanceKm: km1(r.d),
      createdAt: new Date(r.created_at as string).toISOString(),
      author: { username: r.username as string, displayName: r.display_name as string },
    }));
  }

  /**
   * TxillGroups públicos (entra-se logo) e privados no mapa (pede-se para entrar), com o plano num local com posição
   * (só o destino em texto não chega para o mapa). Quem tem bloqueio com o criador ou com um admin não os vê.
   */
  private async groups(p: unknown[]) {
    if (!(await this.probe.bits()).groups) return [];
    const { rows } = await this.pool.query(
      `SELECT * FROM (
         SELECT g.id, g.name, g.kind, g.cover_media_id, g.avatar_media_id, g.visibility, g.destination, g.starts_on, v.name AS venue_name, v.lat, v.lng,
                ${distKm('v.lat', 'v.lng')} AS d,
                (SELECT count(*) FROM social.group_members gm WHERE gm.group_id = g.id)::int AS members
           FROM social.groups g JOIN content.venues v ON v.id = g.plan_venue_id
          WHERE (g.visibility = 'public' OR g.show_on_map) AND v.review_status = 'approved' AND v.lat IS NOT NULL AND v.lng IS NOT NULL AND ${inBox('v.lat', 'v.lng', '$4')}
            AND COALESCE(g.ends_on, g.starts_on, current_date) >= current_date
            AND (g.created_by IS NULL OR NOT ${blockedBetween('g.created_by', '$1')})
            AND NOT ${adminBlocked('g.id', '$1')}
       ) x WHERE x.d <= $4::float8 ORDER BY x.d, x.starts_on NULLS LAST, x.id LIMIT ${LIMITS.groups}`,
      p,
    );
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      kind: r.kind as string,
      coverUrl: media(r.cover_media_id),
      avatarUrl: media(r.avatar_media_id),
      visibility: r.visibility as 'private' | 'public',
      // Público: entra-se logo. Privado no mapa: pede-se e um admin aceita.
      joinMode: (r.visibility === 'public' ? 'open' : 'request') as 'open' | 'request',
      destination: ((r.destination as string | null) ?? (r.venue_name as string)) || null,
      startsOn: r.starts_on ? this.isoDate(r.starts_on) : null,
      lat: Number(r.lat),
      lng: Number(r.lng),
      distanceKm: km1(r.d),
      members: Number(r.members),
    }));
  }

  private isoDate(d: unknown) {
    if (typeof d === 'string') return d.slice(0, 10);
    const x = d as Date;
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }

  /**
   * A malta à tua volta: só quem ligou a visibilidade e me deixa ver (quem segue de volta ou quem segue), adultos dos
   * dois lados, sem bloqueios, nas últimas 3 horas. Mostra-se o centro da quadrícula e a distância em km inteiros (mínimo 1).
   */
  private async people(p: unknown[]) {
    const { rows } = await this.pool.query(
      `SELECT * FROM (
         SELECT u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar, pr.cell_lat, pr.cell_lng, pr.updated_at,
                floor(extract(epoch FROM (now() - pr.updated_at)) / 60)::int AS mins,
                ${distKm('pr.cell_lat', 'pr.cell_lng')} AS d
           FROM nearby.presence pr
           JOIN nearby.settings s ON s.user_id = pr.user_id AND s.visibility <> 'off'
           JOIN identity.users u ON u.id = pr.user_id AND u.status = 'active'
           JOIN identity.users me ON me.id = $1
          WHERE pr.updated_at > now() - interval '${PRESENCE_HOURS} hours'
            AND pr.user_id <> $1
            AND ${ADULT_SQL('me')} AND ${ADULT_SQL('u')}
            AND NOT ${blockedBetween('u.id', '$1')}
            AND EXISTS (SELECT 1 FROM social.follows f1 WHERE f1.follower_id = u.id AND f1.followee_id = $1)
            AND (s.visibility = 'following' OR EXISTS (SELECT 1 FROM social.follows f2 WHERE f2.follower_id = $1 AND f2.followee_id = u.id))
            AND ${inBox('pr.cell_lat', 'pr.cell_lng', '$4')}
       ) x WHERE x.d <= $4::float8 ORDER BY x.updated_at DESC, x.username LIMIT ${LIMITS.people}`,
      p,
    );
    return rows.map((r) => ({
      username: r.username as string,
      displayName: r.display_name as string,
      hasAvatar: !!r.has_avatar,
      lat: Number(r.cell_lat),
      lng: Number(r.cell_lng),
      ago: agoLabel(Number(r.mins)),
      approxKm: Math.max(1, Math.round(Number(r.d))),
    }));
  }

  /** Pesquisa da caixa do mapa: locais e eventos (próximos 30 dias) com o nome, até 30 km. */
  async places(viewerId: string, c: Center, q: string) {
    const term = q.trim().slice(0, 60);
    if (term.length < 2) return { venues: [], events: [] };
    const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const p = [viewerId, c.lat, c.lng, 30, like];
    const [venues, events] = await Promise.all([this.venues(p, true), this.eventsMonth(p)]);
    return { venues: venues.slice(0, 20), events: events.slice(0, 20) };
  }

  /** Eventos da pesquisa: até 30 dias à frente. */
  private async eventsMonth(p: unknown[]) {
    const { rows } = await this.pool.query(
      `SELECT * FROM (
         SELECT e.id, e.title, e.starts_at, e.ends_at, e.cover_media_id, v.slug, v.name, v.lat, v.lng, ${distKm('v.lat', 'v.lng')} AS d,
                (SELECT count(*) FROM content.venue_event_interest i WHERE i.event_id = e.id)::int AS interested
           FROM content.venue_events e JOIN content.venues v ON v.id = e.venue_id
          WHERE e.cancelled_at IS NULL AND ${eventEnd()} > now() AND e.starts_at < now() + interval '30 days'
            AND v.lat IS NOT NULL AND v.lng IS NOT NULL AND ${inBox('v.lat', 'v.lng', '$4')} AND ${VENUE_COUNTRY}
            AND (e.title ILIKE $5 ESCAPE '\\' OR v.name ILIKE $5 ESCAPE '\\')
       ) x WHERE x.d <= $4::float8 ORDER BY x.d, x.starts_at, x.id LIMIT 20`,
      p,
    );
    return rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      startsAt: new Date(r.starts_at as string).toISOString(),
      endsAt: r.ends_at ? new Date(r.ends_at as string).toISOString() : null,
      coverUrl: media(r.cover_media_id),
      venue: { slug: r.slug as string, name: r.name as string, lat: Number(r.lat), lng: Number(r.lng) },
      distanceKm: km1(r.d),
      interested: Number(r.interested),
    }));
  }

  // ---------- Aparecer no mapa ----------

  private async isAdult(userId: string) {
    return !!(await this.pool.query(`SELECT 1 FROM identity.users u WHERE u.id = $1 AND ${ADULT_SQL('u')}`, [userId])).rowCount;
  }

  async settings(userId: string) {
    const r = (await this.pool.query('SELECT visibility FROM nearby.settings WHERE user_id = $1', [userId])).rows[0];
    const adult = await this.isAdult(userId);
    return { visibility: (adult ? ((r?.visibility as NearbyVisibility | undefined) ?? 'off') : 'off') as NearbyVisibility, canEnable: adult };
  }

  async setVisibility(userId: string, visibility: NearbyVisibility) {
    if (visibility !== 'off' && !(await this.isAdult(userId))) throw new BadRequestException('Aparecer no mapa só a partir dos 18 anos');
    await this.pool.query(
      `INSERT INTO nearby.settings (user_id, visibility) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET visibility = EXCLUDED.visibility, updated_at = now()`,
      [userId, visibility],
    );
    if (visibility === 'off') await this.clearPresence(userId);
    return this.settings(userId);
  }

  /** Guarda SÓ a quadrícula (~1,5 km) onde a pessoa está. A posição exata nunca sai desta função. */
  async setPresence(userId: string, lat: number, lng: number) {
    const s = await this.settings(userId);
    if (s.visibility === 'off') throw new BadRequestException('Liga primeiro quem te pode ver no mapa');
    const cell = { lat: snapToCell(lat), lng: snapToCell(lng) };
    // Uma vez por ~minuto: se a última actualização é muito recente, fica a que estava.
    await this.pool.query(
      `INSERT INTO nearby.presence (user_id, cell_lat, cell_lng) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET cell_lat = EXCLUDED.cell_lat, cell_lng = EXCLUDED.cell_lng, updated_at = now()
        WHERE nearby.presence.updated_at < now() - interval '${PRESENCE_GAP_S} seconds'`,
      [userId, cell.lat, cell.lng],
    );
    const r = (await this.pool.query('SELECT cell_lat, cell_lng FROM nearby.presence WHERE user_id = $1', [userId])).rows[0];
    return { visible: true, cell: { lat: Number(r.cell_lat), lng: Number(r.cell_lng) }, expiresInMin: PRESENCE_HOURS * 60 };
  }

  async clearPresence(userId: string) {
    await this.pool.query('DELETE FROM nearby.presence WHERE user_id = $1', [userId]);
    return { visible: false };
  }
}

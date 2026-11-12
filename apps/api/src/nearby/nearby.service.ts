import { BadRequestException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { SPONSORED_LABEL } from '../boosts/boost-config';
import { BoostsService, type MapBoost } from '../boosts/boosts.service';
import { memberBlocked, venueOnMap } from '../groups/group-access';
import { blockedBetween, canView } from '../social/visibility';
import { badge } from '../common/badge';
import { eventEnd } from './events.service';
import { agoLabel, distKm, inBox, km1, postGeo, snapToCell } from './geo-sql';
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
/** O dia de hoje em Maputo (o `current_date` da base é o do fuso da sessão, UTC no servidor). */
const MAPUTO_TODAY = `(now() AT TIME ZONE 'Africa/Maputo')::date`;
/**
 * Onde um TxillGroup fica no mapa: o local do plano (só entra no LEFT JOIN se aprovado e com posição) tem prioridade;
 * senão o ponto que um admin escolheu (já guardado arredondado, como a malta).
 */
const G_LAT = 'COALESCE(v.lat, g.map_lat)';
const G_LNG = 'COALESCE(v.lng, g.map_lng)';
// Os locais que quem os gere tirou do mapa (show_on_map = false) não entram aqui: nem como pino, nem por distância,
// nem os eventos deles (ficam na página do local e na pesquisa por nome).
// Locais de contas apagadas não aparecem: nem eles, nem os eventos deles (no mapa e na pesquisa).
const OWNER_ALIVE = `EXISTS (SELECT 1 FROM identity.users ou WHERE ou.id = v.owner_id AND ou.status <> 'deleted')`;
const VENUE_COUNTRY = `(v.review_status = 'approved' AND v.show_on_map AND (v.country IS NULL OR v.country IS NOT DISTINCT FROM (SELECT vc.country FROM identity.users vc WHERE vc.id = $1)))`;

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
    private readonly boosts: BoostsService,
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
    const [venues, events, posts, groups, people, boosts] = await Promise.all([
      kinds.has('venues') ? this.venues(p) : [],
      kinds.has('events') ? this.events(p, when) : [],
      kinds.has('posts') ? this.posts(p) : [],
      kinds.has('groups') ? this.groups(p) : [],
      kinds.has('people') ? this.people(p) : [],
      // Bombar: os locais e eventos com uma campanha para esta pessoa aqui ficam realçados e no topo da lista.
      kinds.has('venues') || kinds.has('events') ? this.boosts.forMap(viewerId, c) : [],
    ]);
    const h = this.highlight(venues, events, boosts);
    await this.boosts.recordMapViews(viewerId, h.shown);
    return { center: { lat: c.lat, lng: c.lng }, radiusKm, venues: h.venues, events: h.events, posts, groups, people };
  }

  /**
   * Marca `boosted` (com a etiqueta "Patrocinado") no pino do evento de uma campanha de evento, ou no do local numa
   * campanha de publicação, e põe-nos à frente (pela distância entre eles). `shown`: as campanhas que ficaram à vista.
   */
  private highlight<V extends { slug: string }, E extends { id: string }>(venues: V[], events: E[], boosts: MapBoost[]) {
    const byEvent = new Map(boosts.filter((b) => b.kind === 'event' && b.eventId).map((b) => [b.eventId!, b]));
    const byVenue = new Map(boosts.filter((b) => b.kind === 'post').map((b) => [b.venueSlug, b]));
    const shown = new Set<string>();
    const tag = <T>(x: T, b: MapBoost | undefined) => {
      if (!b) return { ...x, boosted: null };
      shown.add(b.campaignId);
      return { ...x, boosted: { campaignId: b.campaignId, label: SPONSORED_LABEL } };
    };
    const first = <T extends { boosted: unknown }>(xs: T[]) => [...xs.filter((x) => x.boosted), ...xs.filter((x) => !x.boosted)];
    return {
      venues: first(venues.map((v) => tag(v, byVenue.get(v.slug)))),
      events: first(events.map((e) => tag(e, byEvent.get(e.id)))),
      shown: [...shown],
    };
  }

  private async venues(p: unknown[], search = false) {
    const { accepts } = await this.probe.bits();
    const { rows } = await this.pool.query(
      // Os check-ins e os seguidores contam-se só para os locais que ficam (depois do LIMIT), não para todos os da caixa.
      `WITH perto AS (
         SELECT * FROM (
           SELECT v.id, v.slug, v.name, v.kind, v.avatar_media_id, v.verified, v.lat, v.lng, ${accepts ? 'v.accepts_txills' : 'NULL::boolean'} AS accepts_txills,
                  ${distKm('v.lat', 'v.lng')} AS d
             FROM content.venues v
            WHERE v.lat IS NOT NULL AND v.lng IS NOT NULL AND ${inBox('v.lat', 'v.lng', '$4')} AND ${VENUE_COUNTRY} AND ${OWNER_ALIVE}
              ${search ? `AND (v.name ILIKE $5 ESCAPE '\\' OR v.city ILIKE $5 ESCAPE '\\')` : ''}
         ) x WHERE x.d <= $4::float8 ORDER BY x.d, x.verified DESC, x.slug LIMIT ${LIMITS.venues}
       )
       SELECT perto.*,
              (SELECT count(*) FROM content.checkins ch WHERE ch.venue_id = perto.id AND ch.created_at > now() - interval '24 hours')::int AS checkins_today,
              (SELECT count(*) FROM content.venue_follows f WHERE f.venue_id = perto.id)::int AS followers
         FROM perto ORDER BY perto.d, perto.verified DESC, perto.slug`,
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
    return this.eventRows(p, window, LIMITS.events);
  }

  /**
   * Eventos não cancelados de locais no mapa, do país de quem vê e de contas que não foram apagadas, até ao raio ($4).
   * O número de interessados conta-se só para os eventos que ficam (depois do LIMIT).
   */
  private async eventRows(p: unknown[], where: string, limit: number) {
    const { rows } = await this.pool.query(
      `WITH perto AS (
         SELECT * FROM (
           SELECT e.id, e.title, e.starts_at, e.ends_at, e.cover_media_id, v.slug, v.name, v.lat, v.lng, ${distKm('v.lat', 'v.lng')} AS d
             FROM content.venue_events e JOIN content.venues v ON v.id = e.venue_id
            WHERE e.cancelled_at IS NULL AND ${where}
              AND v.lat IS NOT NULL AND v.lng IS NOT NULL AND ${inBox('v.lat', 'v.lng', '$4')} AND ${VENUE_COUNTRY} AND ${OWNER_ALIVE}
         ) x WHERE x.d <= $4::float8 ORDER BY x.d, x.starts_at, x.id LIMIT ${limit}
       )
       SELECT perto.*, (SELECT count(*) FROM content.venue_event_interest i WHERE i.event_id = perto.id)::int AS interested
         FROM perto ORDER BY perto.d, perto.starts_at, perto.id`,
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
           SELECT p.id, p.short_code, p.location_label, ${postGeo('lat')} AS location_lat, ${postGeo('lng')} AS location_lng, p.created_at, p.author_id, u.username, u.display_name, u.verified, u.verified_tier,
                  ${distKm(postGeo('lat'), postGeo('lng'))} AS d,
                  fm.media_id AS first_media, (fm.mime LIKE 'video/%') AS is_video
             FROM content.posts p
             JOIN identity.users u ON u.id = p.author_id
             LEFT JOIN content.venues pv ON pv.id = p.venue_id
             JOIN LATERAL (SELECT pm.media_id, ma.mime FROM content.post_media pm JOIN content.media_assets ma ON ma.id = pm.media_id
                            WHERE pm.post_id = p.id ORDER BY pm.position LIMIT 1) fm ON true
            -- Só publicações normais (sem reposts nem presentes) e nunca as minhas: aqui vê-se o que os outros publicam à volta.
            WHERE p.removed_at IS NULL AND p.kind = 'post' AND p.created_at > now() - interval '48 hours' AND p.author_id <> $1
              AND p.location_lat IS NOT NULL AND p.location_lng IS NOT NULL AND ${inBox('p.location_lat', 'p.location_lng', '$4')}
              AND ${ADULT_SQL('u')}
              AND ${canView('u')}
              -- Publicado como um local que saiu do mapa: a posição é a do local, não se mostra.
              AND NOT (pv.id IS NOT NULL AND NOT pv.show_on_map)
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
      author: { username: r.username as string, displayName: r.display_name as string, ...badge(r.verified, r.verified_tier) },
    }));
  }

  /**
   * TxillGroups públicos (entra-se logo) e privados no mapa (pede-se para entrar), com sítio no mapa: o local do plano
   * aprovado e com posição ou, sem ele, o ponto arredondado que um admin escolheu (só o destino em texto não chega).
   * `placeLabel`: o nome do local, ou o nome dado ao ponto. Quem tem bloqueio com algum membro (ou com quem o criou) não os vê.
   */
  private async groups(p: unknown[]) {
    if (!(await this.probe.bits()).groups) return [];
    const { rows } = await this.pool.query(
      `SELECT * FROM (
         SELECT g.id, g.name, g.kind, g.cover_media_id, g.avatar_media_id, g.visibility, g.destination, g.starts_on, v.name AS venue_name,
                CASE WHEN v.id IS NOT NULL THEN v.name ELSE g.map_label END AS place_label,
                ${G_LAT} AS lat, ${G_LNG} AS lng,
                ${distKm(G_LAT, G_LNG)} AS d,
                (SELECT count(*) FROM social.group_members gm WHERE gm.group_id = g.id)::int AS members
           FROM social.groups g LEFT JOIN content.venues v ON v.id = g.plan_venue_id AND ${venueOnMap('v')}
          WHERE (g.visibility = 'public' OR g.show_on_map) AND ${G_LAT} IS NOT NULL AND ${G_LNG} IS NOT NULL AND ${inBox(G_LAT, G_LNG, '$4')}
            -- O dia de hoje é o de Maputo: entre a meia-noite e as 2h de Maputo, em UTC ainda é o dia anterior.
            AND COALESCE(g.ends_on, g.starts_on, ${MAPUTO_TODAY}) >= ${MAPUTO_TODAY}
            AND NOT ${memberBlocked('g.id', '$1')}
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
      destination: ((r.destination as string | null) ?? (r.venue_name as string | null) ?? (r.place_label as string | null)) || null,
      // O nome do sítio no mapa: o do local do plano, ou o que o admin deu ao ponto (pode não haver).
      placeLabel: (r.place_label as string | null) ?? null,
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
         SELECT u.username, u.display_name, u.verified, u.verified_tier, (u.avatar_media_id IS NOT NULL) AS has_avatar, pr.cell_lat, pr.cell_lng, pr.updated_at,
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
      ...badge(r.verified, r.verified_tier),
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
  private eventsMonth(p: unknown[]) {
    return this.eventRows(
      p,
      `${eventEnd()} > now() AND e.starts_at < now() + interval '30 days' AND (e.title ILIKE $5 ESCAPE '\\' OR v.name ILIKE $5 ESCAPE '\\')`,
      20,
    );
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

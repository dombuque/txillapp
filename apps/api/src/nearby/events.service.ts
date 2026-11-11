import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { TextFilter } from '../safety/text-filter.service';
import { SchemaProbe } from './schema-probe';

/** Até quando um evento sem hora de fim conta como "a decorrer". */
export const DEFAULT_EVENT_HOURS = 4;
/** O fim de um evento: o indicado ou, sem ele, 4 horas depois do início. */
export const eventEnd = (e = 'e') => `COALESCE(${e}.ends_at, ${e}.starts_at + interval '${DEFAULT_EVENT_HOURS} hours')`;

const MAX_UPCOMING_PER_VENUE = 100;
const DAY = 86_400_000;

export interface EventInput {
  title?: string;
  description?: string | null;
  startsAt?: string;
  endsAt?: string | null;
  coverMediaId?: string | null;
}

const media = (id: unknown) => (id ? `/api/v1/media/${id as string}` : null);

/**
 * Eventos dos locais: o dono e os gestores activos (administrador ou editor) criam, mudam e cancelam.
 * Qualquer pessoa vê e pode marcar "tenho interesse" (sem notificações).
 */
@Injectable()
export class EventsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly filter: TextFilter,
    private readonly probe: SchemaProbe,
  ) {}

  private async select() {
    const { accepts } = await this.probe.bits();
    return `
      SELECT e.id, e.title, e.description, e.starts_at, e.ends_at, e.cover_media_id, e.cancelled_at,
             v.slug, v.name, v.avatar_media_id, v.verified, v.lat, v.lng, v.show_on_map, ${accepts ? 'v.accepts_txills' : 'NULL::boolean'} AS accepts_txills,
             (SELECT count(*) FROM content.venue_event_interest i WHERE i.event_id = e.id)::int AS interested,
             EXISTS (SELECT 1 FROM content.venue_event_interest i WHERE i.event_id = e.id AND i.user_id = $1) AS mine,
             (v.owner_id = $1 OR EXISTS (SELECT 1 FROM content.venue_managers m WHERE m.venue_id = v.id AND m.user_id = $1 AND m.status = 'active')) AS can_manage
        FROM content.venue_events e JOIN content.venues v ON v.id = e.venue_id`;
  }

  private dto(r: Record<string, unknown>) {
    return {
      id: r.id as string,
      title: r.title as string,
      description: (r.description as string | null) ?? null,
      startsAt: new Date(r.starts_at as string).toISOString(),
      endsAt: r.ends_at ? new Date(r.ends_at as string).toISOString() : null,
      coverUrl: media(r.cover_media_id),
      cancelled: !!r.cancelled_at,
      canManage: !!r.can_manage,
      venue: {
        slug: r.slug as string,
        name: r.name as string,
        avatarUrl: media(r.avatar_media_id),
        verified: !!r.verified,
        // Local fora do mapa: o evento não leva posição (nem para quem o gere; a do local vê-se na página dele).
        lat: r.lat == null || r.show_on_map === false ? null : Number(r.lat),
        lng: r.lng == null || r.show_on_map === false ? null : Number(r.lng),
        ...(r.accepts_txills == null ? {} : { acceptsTxills: !!r.accepts_txills }),
      },
      interested: Number(r.interested),
      imInterested: !!r.mine,
    };
  }

  /** O local, se a pessoa o gere (dono ou gestor activo). */
  private async managedVenue(userId: string, slug: string) {
    const v = (await this.pool.query(
      `SELECT v.id, v.review_status, (v.owner_id = $2 OR EXISTS (SELECT 1 FROM content.venue_managers m WHERE m.venue_id = v.id AND m.user_id = $2 AND m.status = 'active')) AS ok
         FROM content.venues v WHERE v.slug = $1`,
      [slug.toLowerCase(), userId],
    )).rows[0];
    if (!v) throw new NotFoundException('Local não encontrado');
    if (!v.ok) throw new ForbiddenException('Só quem gere o local pode tratar dos eventos');
    if (v.review_status !== 'approved') throw new ForbiddenException('O local ainda está em análise. Os eventos ficam disponíveis depois de a equipa o aprovar.');
    return v.id as string;
  }

  /** O evento, se a pessoa gere o local dele. */
  private async managedEvent(userId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Evento não encontrado');
    const e = (await this.pool.query(
      `SELECT e.id, e.starts_at, e.ends_at, e.cancelled_at,
              (v.owner_id = $2 OR EXISTS (SELECT 1 FROM content.venue_managers m WHERE m.venue_id = v.id AND m.user_id = $2 AND m.status = 'active')) AS ok
         FROM content.venue_events e JOIN content.venues v ON v.id = e.venue_id WHERE e.id = $1`,
      [id, userId],
    )).rows[0];
    if (!e) throw new NotFoundException('Evento não encontrado');
    if (!e.ok) throw new ForbiddenException('Só quem gere o local pode tratar dos eventos');
    return e as { id: string; starts_at: Date; ends_at: Date | null; cancelled_at: Date | null };
  }

  /** Uma foto própria, já carregada e livre (como a capa do local). */
  private async assertImage(userId: string, mediaId: string) {
    const ok = await this.pool.query(
      `SELECT 1 FROM content.media_assets a WHERE a.id = $1 AND a.owner_id = $2 AND a.status = 'ready' AND a.mime LIKE 'image/%'
          AND NOT EXISTS (SELECT 1 FROM content.post_media pm WHERE pm.media_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM content.stories s WHERE s.media_id = a.id)`,
      [mediaId, userId],
    );
    if (!ok.rowCount) throw new BadRequestException('Foto inválida ou ainda não carregada');
  }

  private checkDates(starts: Date, ends: Date | null, isNew: boolean) {
    if (Number.isNaN(starts.getTime()) || (ends && Number.isNaN(ends.getTime()))) throw new BadRequestException('Data inválida');
    const now = Date.now();
    if (isNew && starts.getTime() < now - 3_600_000) throw new BadRequestException('O evento não pode começar no passado');
    if (starts.getTime() > now + 365 * DAY) throw new BadRequestException('Só dá para anunciar eventos até daqui a um ano');
    if (ends && ends.getTime() <= starts.getTime()) throw new BadRequestException('O fim tem de ser depois do início');
    if (ends && ends.getTime() - starts.getTime() > 14 * DAY) throw new BadRequestException('Um evento dura no máximo 14 dias');
  }

  async create(userId: string, b: EventInput & { venueSlug: string; title: string; startsAt: string }) {
    const venueId = await this.managedVenue(userId, b.venueSlug);
    this.filter.assertClean(b.title, b.description ?? '');
    const starts = new Date(b.startsAt);
    const ends = b.endsAt ? new Date(b.endsAt) : null;
    this.checkDates(starts, ends, true);
    if (b.coverMediaId) await this.assertImage(userId, b.coverMediaId);
    const n = (await this.pool.query(
      `SELECT count(*)::int AS n FROM content.venue_events e WHERE e.venue_id = $1 AND e.cancelled_at IS NULL AND ${eventEnd()} > now()`,
      [venueId],
    )).rows[0].n as number;
    if (n >= MAX_UPCOMING_PER_VENUE) throw new ForbiddenException(`Até ${MAX_UPCOMING_PER_VENUE} eventos por anunciar em cada local`);
    const id = uuidv7();
    await this.pool.query(
      `INSERT INTO content.venue_events (id, venue_id, title, description, starts_at, ends_at, cover_media_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, venueId, b.title.trim(), b.description?.trim() || null, starts, ends, b.coverMediaId ?? null, userId],
    );
    return this.get(userId, id);
  }

  async update(userId: string, id: string, b: EventInput) {
    const e = await this.managedEvent(userId, id);
    if (e.cancelled_at) throw new BadRequestException('Este evento foi cancelado');
    this.filter.assertClean(b.title ?? '', b.description ?? '');
    const starts = b.startsAt !== undefined ? new Date(b.startsAt) : new Date(e.starts_at);
    const ends = b.endsAt !== undefined ? (b.endsAt ? new Date(b.endsAt) : null) : e.ends_at ? new Date(e.ends_at) : null;
    this.checkDates(starts, ends, b.startsAt !== undefined);
    if (b.coverMediaId) await this.assertImage(userId, b.coverMediaId);
    const sets: string[] = [];
    const vals: unknown[] = [id];
    const set = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    if (b.title !== undefined) set('title', b.title.trim());
    if (b.description !== undefined) set('description', b.description?.trim() || null);
    if (b.startsAt !== undefined) set('starts_at', starts);
    if (b.endsAt !== undefined) set('ends_at', ends);
    if (b.coverMediaId !== undefined) set('cover_media_id', b.coverMediaId);
    if (sets.length) await this.pool.query(`UPDATE content.venue_events SET ${sets.join(', ')} WHERE id = $1`, vals);
    return this.get(userId, id);
  }

  /** Cancelar: o evento fica (quem tinha interesse vê que foi cancelado), mas sai das listas e do mapa. */
  async cancel(userId: string, id: string) {
    await this.managedEvent(userId, id);
    await this.pool.query('UPDATE content.venue_events SET cancelled_at = now() WHERE id = $1 AND cancelled_at IS NULL', [id]);
    return this.get(userId, id);
  }

  async get(viewerId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Evento não encontrado');
    const r = (await this.pool.query(`${await this.select()} WHERE e.id = $2`, [viewerId, id])).rows[0];
    if (!r) throw new NotFoundException('Evento não encontrado');
    return this.dto(r);
  }

  async setInterest(userId: string, id: string, on: boolean) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Evento não encontrado');
    const e = (await this.pool.query('SELECT cancelled_at FROM content.venue_events WHERE id = $1', [id])).rows[0];
    if (!e) throw new NotFoundException('Evento não encontrado');
    if (on) {
      if (e.cancelled_at) throw new BadRequestException('Este evento foi cancelado');
      await this.pool.query('INSERT INTO content.venue_event_interest (event_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, userId]);
    } else {
      await this.pool.query('DELETE FROM content.venue_event_interest WHERE event_id = $1 AND user_id = $2', [id, userId]);
    }
    const n = (await this.pool.query('SELECT count(*)::int AS n FROM content.venue_event_interest WHERE event_id = $1', [id])).rows[0].n as number;
    return { interested: n, imInterested: on };
  }

  /** Os próximos eventos de um local (ainda por acabar, não cancelados), do mais próximo no tempo. */
  async upcoming(viewerId: string, slug: string) {
    const v = (await this.pool.query('SELECT id FROM content.venues WHERE slug = $1', [slug.toLowerCase()])).rows[0];
    if (!v) throw new NotFoundException('Local não encontrado');
    const { rows } = await this.pool.query(
      `${await this.select()} WHERE e.venue_id = $2 AND e.cancelled_at IS NULL AND ${eventEnd()} > now() ORDER BY e.starts_at, e.id LIMIT 50`,
      [viewerId, v.id],
    );
    return { items: rows.map((r) => this.dto(r)) };
  }
}

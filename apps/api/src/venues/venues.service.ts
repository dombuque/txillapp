import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { TextFilter } from '../safety/text-filter.service';

export const VENUE_KINDS = ['bar', 'restaurante', 'discoteca', 'cafe', 'hotel', 'evento', 'outro'] as const;
export type VenueKind = (typeof VENUE_KINDS)[number];

/** Quantos locais cada pessoa pode criar (contra abusos), e o intervalo entre check-ins no mesmo local. */
const MAX_VENUES = 3;
const CHECKIN_GAP_HOURS = 6;

const slugOf = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

/**
 * Locais: bares, restaurantes, discotecas… Cada local tem uma página, um dono e, depois de verificado pela equipa, o selo.
 * O check-in faz-se lendo o QR do local (a ligação leva um código). Só se mostram números de check-ins, nunca quem foi.
 */
@Injectable()
export class VenuesService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly filter: TextFilter,
  ) {}

  private dto(r: Record<string, any>, viewerId: string) {
    const mine = r.owner_id === viewerId;
    return {
      id: r.id as string,
      slug: r.slug as string,
      name: r.name as string,
      kind: r.kind as VenueKind,
      city: (r.city as string | null) ?? null,
      about: (r.about as string | null) ?? null,
      verified: !!r.verified,
      lat: (r.lat as number | null) ?? null,
      lng: (r.lng as number | null) ?? null,
      checkins: Number(r.checkins ?? 0),
      checkinsToday: Number(r.checkins_today ?? 0),
      mine,
      // O código do QR só o dono o vê (para imprimir).
      qrToken: mine ? (r.check_token as string) : undefined,
      checkedIn: !!r.checked_in,
    };
  }

  private readonly SELECT = `
    SELECT v.*,
           (SELECT count(*) FROM content.checkins c WHERE c.venue_id = v.id) AS checkins,
           (SELECT count(*) FROM content.checkins c WHERE c.venue_id = v.id AND c.created_at > now() - interval '24 hours') AS checkins_today,
           EXISTS (SELECT 1 FROM content.checkins c WHERE c.venue_id = v.id AND c.user_id = $2 AND c.created_at > now() - interval '${CHECKIN_GAP_HOURS} hours') AS checked_in
      FROM content.venues v`;

  async create(userId: string, b: { name: string; kind: VenueKind; city?: string; about?: string; lat?: number; lng?: number }) {
    this.filter.assertClean(b.name, b.city ?? '', b.about ?? '');
    const have = (await this.pool.query('SELECT count(*)::int AS n FROM content.venues WHERE owner_id = $1', [userId])).rows[0].n as number;
    if (have >= MAX_VENUES) throw new ForbiddenException(`Podes ter até ${MAX_VENUES} locais`);
    const base = slugOf(b.name);
    if (base.length < 3) throw new BadRequestException('Escolhe um nome com pelo menos 3 letras');
    let slug = base;
    for (let i = 2; (await this.pool.query('SELECT 1 FROM content.venues WHERE slug = $1', [slug])).rowCount; i++) slug = `${base.slice(0, 46)}-${i}`;
    const id = uuidv7();
    const country = (await this.pool.query('SELECT country FROM identity.users WHERE id = $1', [userId])).rows[0]?.country ?? null;
    const q = (n: number | undefined) => (n == null ? null : Math.round(n * 1000) / 1000);
    await this.pool.query(
      'INSERT INTO content.venues (id, slug, name, kind, city, country, lat, lng, about, owner_id, check_token) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [id, slug, b.name.trim(), b.kind, b.city?.trim() || null, country, q(b.lat), q(b.lng), b.about?.trim() || null, userId, randomBytes(12).toString('hex')],
    );
    return this.get(userId, slug);
  }

  async get(viewerId: string, slug: string) {
    const r = (await this.pool.query(`${this.SELECT} WHERE v.slug = $1`, [slug.toLowerCase(), viewerId])).rows[0];
    if (!r) throw new NotFoundException('Local não encontrado');
    return this.dto(r, viewerId);
  }

  /** O local com este nome (usado pelo nome do sítio de uma publicação): o verificado primeiro. */
  async findByName(viewerId: string, name: string) {
    const r = (await this.pool.query(`${this.SELECT} WHERE lower(v.name) = lower($1) ORDER BY v.verified DESC, v.created_at LIMIT 1`, [name.trim().slice(0, 80), viewerId])).rows[0];
    return r ? this.dto(r, viewerId) : null;
  }

  async mine(userId: string) {
    const rows = (await this.pool.query(`${this.SELECT} WHERE v.owner_id = $2 ORDER BY v.created_at DESC`, [userId, userId])).rows;
    return rows.map((r) => this.dto(r, userId));
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

  /** A equipa verifica (ou tira o selo a) um local. */
  async setVerified(slug: string, verified: boolean) {
    const r = await this.pool.query('UPDATE content.venues SET verified = $2 WHERE slug = $1', [slug.toLowerCase(), verified]);
    if (!r.rowCount) throw new NotFoundException('Local não encontrado');
    return { slug, verified };
  }

  /** O dono muda o QR (se ele andou a circular fora do local). */
  async rotateToken(userId: string, slug: string) {
    const r = await this.pool.query('UPDATE content.venues SET check_token = $3 WHERE slug = $1 AND owner_id = $2', [slug.toLowerCase(), userId, randomBytes(12).toString('hex')]);
    if (!r.rowCount) throw new NotFoundException('Local não encontrado');
    return this.get(userId, slug);
  }
}

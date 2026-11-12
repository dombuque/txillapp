import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { z } from 'zod';
import { PG_POOL } from '../db/db.module';
import { MediaService } from '../media/media.service';
import { MusicCatalogService, storedTrack } from './catalog/catalog.service';
import { hostOk, httpsOnly } from './catalog/curation';
import { MUSIC_SOURCES, OPEN_LICENSES, type PickerTrack } from './catalog/track';

/** Licenças que deixam pôr a faixa num mimo ou num tcheka partilhado (ver catalog/track.ts): nada de NC, ND nem SA. */
const LICENSES = new Set<string>(OPEN_LICENSES);
const LOCAL = /^local:/;

/** A faixa como fica guardada num post, story, nota ou nas favoritas (o formato antigo; ver docs/musica.md). */
export interface Track {
  id: string;
  title: string;
  artist: string;
  url: string;
  /** Página original, para o crédito. */
  landing: string | null;
  license: string;
  licenseUrl: string | null;
  durationMs: number | null;
  cover: string | null;
  source?: string;
  artistUsername?: string;
}

const link = (max: number) => z.string().url().max(max).refine(httpsOnly, 'Ligação inválida');

/** A faixa que uma nota leva: validada no servidor (nunca confiamos no que a app manda). */
export const trackSchema = z
  .object({
    id: z.string().min(1).max(80),
    title: z.string().trim().min(1).max(120),
    artist: z.string().trim().max(120).default(''),
    url: link(500),
    landing: link(500).nullable().default(null),
    license: z.string().max(20),
    licenseUrl: link(300).nullable().default(null),
    durationMs: z.number().int().positive().max(3_600_000).nullable().default(null),
    cover: link(500).nullable().default(null),
    source: z.enum(MUSIC_SOURCES).optional(),
    artistUsername: z.string().regex(/^[A-Za-z0-9_.]{1,30}$/).optional(),
  })
  // As faixas da fonte local (artistas de Moçambique) estão no Txillapp: o servidor troca-as pela versão dele (prepare).
  .refine((t) => LOCAL.test(t.id) || hostOk(t.url), { message: 'Faixa de um sítio não permitido', path: ['url'] })
  .refine((t) => LICENSES.has(t.license.toLowerCase()) || (LOCAL.test(t.id) && t.license === 'txillapp'), { message: 'Licença não permitida', path: ['license'] });

/** Clipe de áudio gravado pela própria pessoa (até 30 s): fica no armazenamento privado e é servido com URL assinado. */
export const clipSchema = z.object({
  kind: z.literal('clip'),
  mediaId: z.string().uuid(),
  durationMs: z.number().int().min(500).max(30_000),
  title: z.string().trim().max(60).default('Áudio original'),
});

/** O que uma nota ou um post pode levar: uma faixa de licença aberta ou um clipe próprio. */
export const musicSchema = z.union([clipSchema, trackSchema]);
export type MusicInput = z.infer<typeof musicSchema>;

/**
 * Música nas notas, nos posts e nos mimos: o catálogo curado (catalog/catalog.service.ts), as favoritas e os clipes próprios.
 */
@Injectable()
export class MusicService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly media: MediaService,
    private readonly catalog: MusicCatalogService,
  ) {}

  /** A versão do catálogo, quando a faixa é do catálogo ou da fonte local (a app não muda o título, o artista nem o áudio). */
  private async canonical(t: z.infer<typeof trackSchema>): Promise<Record<string, unknown>> {
    const c = await this.catalog.canonical(t.id);
    if (c.found) return storedTrack(c.track);
    // Faixas antigas (antes do catálogo, do Openverse): continuam a valer com a validação do esquema.
    const { source: _s, artistUsername: _a, ...rest } = t;
    return rest;
  }

  /** Antes de guardar: um clipe tem de ser áudio meu, privado e já carregado (nunca de outra pessoa). */
  async prepare(userId: string, music: MusicInput | null | undefined): Promise<Record<string, unknown> | null> {
    if (!music) return null;
    if (!('kind' in music)) {
      const t = await this.canonical(music);
      this.catalog.invalidate(); // «Em alta» conta já este uso
      return t;
    }
    const r = await this.pool.query(`SELECT 1 FROM content.media_assets WHERE id = $1 AND owner_id = $2 AND purpose = 'chat' AND status = 'ready' AND mime LIKE 'audio/%'`, [music.mediaId, userId]);
    if (!r.rowCount) throw new BadRequestException('Áudio inválido ou ainda não carregado');
    return { kind: 'clip', mediaId: music.mediaId, durationMs: music.durationMs, title: music.title };
  }

  /** Ao devolver: o clipe ganha um URL assinado e temporário (como as mensagens de voz). */
  resolve(music: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!music || music.kind !== 'clip') return music;
    return { ...music, id: `clip:${music.mediaId as string}`, artist: '', url: this.media.chatUrl(music.mediaId as string), landing: null, license: 'own', licenseUrl: null, cover: null };
  }

  /** As minhas faixas favoritas, as mais recentes primeiro. */
  async favorites(userId: string): Promise<Track[]> {
    const { rows } = await this.pool.query('SELECT track FROM content.music_favorites WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200', [userId]);
    return rows.map((r) => r.track as Track);
  }

  /** Marcar uma faixa como favorita (validada como qualquer outra; clipes próprios não entram). Até 200. */
  async addFavorite(userId: string, input: z.infer<typeof trackSchema>): Promise<{ favorite: true }> {
    const n = (await this.pool.query('SELECT count(*)::int AS n FROM content.music_favorites WHERE user_id = $1', [userId])).rows[0].n as number;
    if (n >= 200) throw new BadRequestException('Já tens 200 favoritas. Tira algumas para juntar mais');
    const track = await this.canonical(input);
    await this.pool.query('INSERT INTO content.music_favorites (user_id, track_id, track) VALUES ($1, $2, $3) ON CONFLICT (user_id, track_id) DO UPDATE SET track = EXCLUDED.track', [userId, track.id, JSON.stringify(track)]);
    return { favorite: true };
  }

  async removeFavorite(userId: string, trackId: string): Promise<{ favorite: false }> {
    await this.pool.query('DELETE FROM content.music_favorites WHERE user_id = $1 AND track_id = $2', [userId, trackId]);
    return { favorite: false };
  }

  /** Para as versões antigas da app: «A tocar no Txillapp» (agora «Em alta», do catálogo) e as que usei há pouco. */
  async suggested(userId: string): Promise<{ trending: PickerTrack[]; recent: PickerTrack[] }> {
    const home = await this.catalog.home(userId);
    return { trending: home.trending.slice(0, 12), recent: home.recent };
  }

  /** Pesquisa no catálogo curado (já não vai às fontes a cada pedido). */
  search(userId: string, term: string): Promise<PickerTrack[]> {
    return this.catalog.search(userId, term);
  }
}

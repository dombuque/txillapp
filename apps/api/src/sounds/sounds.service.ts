import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Pool } from 'pg';
import { promisify } from 'util';
import { badge, badgeJson, type Badge } from '../common/badge';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { MediaService, type Served } from '../media/media.service';
import { VideoService } from '../media/video.service';
import { MusicCatalogService, storedTrack } from '../music/catalog/catalog.service';
import { MUSIC_SOURCES, type PickerTrack } from '../music/catalog/track';
import type { MusicInput } from '../music/music.service';
import { canView, inMyNetwork } from '../social/visibility';

const run = promisify(execFile);
const FFMPEG = (ffmpegPath as unknown as string | null) ?? 'ffmpeg';

/** O trecho de um som original: o áudio da tcheka até 60 s (as tchekas têm até 60 s). */
export const SOUND_MAX_MS = 60_000;
/** Abaixo disto (pico em dB) o vídeo conta como «sem som»: não se cria um som original (gravações mudas, ruído de fundo). */
export const SILENT_DB = -50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CATALOG_SOURCES = new Set<string>(MUSIC_SOURCES.filter((s) => s !== 'local'));

export type SoundKind = 'original' | 'catalog' | 'local';
export type SoundRef = { kind: 'original'; id: string } | { kind: 'catalog' | 'local'; id: string; trackId: string };

/**
 * O id de um som: um uuid (som original), `cat:<id da faixa>` (catálogo curado) ou `local:<uuid>` (artistas de Moçambique,
 * o próprio id da faixa). Ver docs/sons.md.
 */
export function parseSoundId(id: string): SoundRef | null {
  if (typeof id !== 'string' || id.length > 90) return null;
  if (UUID.test(id)) return { kind: 'original', id };
  if (/^local:[0-9a-f-]{36}$/.test(id)) return { kind: 'local', id, trackId: id };
  const m = /^cat:([\w.:-]{1,80})$/.exec(id);
  if (m && !m[1].startsWith('local:')) return { kind: 'catalog', id, trackId: m[1] };
  return null;
}

/** O id do som de uma faixa. */
export const soundIdOfTrack = (trackId: string) => (trackId.startsWith('local:') ? trackId : `cat:${trackId}`);

/** O título de um som original: segue o @ atual do autor (se mudar de nome, o som muda com ele). */
export const originalTitle = (username: string) => `Som original · @${username}`;

export interface SoundAuthor extends Badge { username: string; displayName: string }

/** A entidade «som» do contrato (GET /sounds/:id). */
export interface SoundDto {
  id: string;
  kind: SoundKind;
  title: string;
  author?: SoundAuthor;
  /** Catálogo e artistas: o nome do artista, para o crédito. */
  artist?: string;
  cover: string | null;
  durationMs: number | null;
  previewUrl: string | null;
  /** Tchekas que usam este som (só números; publicações apagadas não contam). */
  uses: number;
  createdAt: string | null;
  /** Catálogo e artistas: a faixa como o seletor a mostra (docs/musica.md). */
  music?: PickerTrack;
  /** Quem está a ver pode usá-lo numa tcheka nova («Usar este som»). */
  canUse: boolean;
  /** Porque não: `held` (denúncia em análise), `off` (o autor desligou «Deixar usar o meu som»), `private` (conta privada), `minor` (conta de menor), `unavailable` (a faixa saiu do catálogo). */
  unavailable?: 'held' | 'off' | 'private' | 'minor' | 'unavailable';
  /** O som é meu (som original da minha tcheka). */
  mine: boolean;
  /** Som original: a tcheka de onde saiu. */
  sourcePost?: { id: string; code: string } | null;
}

/** O resumo de cada som em «Sons em alta» (só números agregados, nunca quem usou). */
export interface TrendingSound extends Omit<SoundDto, 'music' | 'canUse' | 'unavailable' | 'mine' | 'sourcePost'> {
  /** Tchekas com este som nos últimos 7 dias. */
  uses7d: number;
}

/** O som que uma publicação mostra (`sound` em cada tcheka). */
export interface PostSound { id: string; title: string; kind: SoundKind; author?: SoundAuthor; artist?: string }

/**
 * Pode ser usado por outra pessoa? A definição «Deixar usar o meu som», uma conta pública e de um adulto (18+). Em SQL, com
 * `u` = o autor do som. O próprio autor pode sempre voltar a usar o seu som.
 */
export const SOUND_TERMS = '2026-11-14'; // só depois de o autor aceitar os Termos que dão essa licença (as tchekas antigas não ficam usáveis sem isso)
export const REUSABLE = (u = 'ou') =>
  `(${u}.sound_reuse AND NOT ${u}.is_private AND ${u}.birth_date <= (current_date - interval '18 years') AND ${u}.terms_version >= '${SOUND_TERMS}')`;

/**
 * O som existe para quem está a ver ($1): não foi tirado e, num som original, a conta está ativa, quem vê pode ver a conta
 * (canView: sem bloqueio, pública ou seguidor) e a tcheka de onde saiu ainda existe. `s` = content.sounds, `ou` = o autor.
 */
export const SOUND_VISIBLE = (s = 's', ou = 'ou') =>
  `(${s}.removed_at IS NULL AND (${s}.kind <> 'original' OR (${canView(ou)} AND EXISTS (SELECT 1 FROM content.posts sp WHERE sp.id = ${s}.source_post_id AND sp.removed_at IS NULL))))`;

/**
 * O `sound` de cada publicação (FEED_SQL, com $1 = quem vê): só quando o som existe para quem vê. O título de um som original
 * segue o @ atual do autor; numa faixa local, o autor é a conta do artista (se estiver ativa).
 */
export const POST_SOUND_SQL = (p = 'p') => `(SELECT json_build_object('id', s.id, 'kind', s.kind,
         'title', CASE WHEN s.kind = 'original' THEN 'Som original · @' || ou.username ELSE s.title END,
         'artist', s.track->>'artist',
         'author', CASE WHEN ou.id IS NOT NULL AND ou.status = 'active' THEN json_build_object('username', ou.username, 'displayName', ou.display_name, ${badgeJson('ou')}) END)
    FROM content.sounds s LEFT JOIN identity.users ou ON ou.id = s.owner_id
   WHERE s.id = ${p}.sound_id AND ${SOUND_VISIBLE()})`;

/** O áudio de um som original guardado como música de uma tcheka (o que fica em posts.music). Ver MusicService.resolve. */
export const MUSIC_SOUND_OK = (p = 'p') =>
  `(${p}.music->>'kind' IS DISTINCT FROM 'sound' OR EXISTS (SELECT 1 FROM content.sounds ms JOIN identity.users mu ON mu.id = ms.owner_id
     WHERE ms.id = ${p}.music->>'soundId' AND ms.removed_at IS NULL AND mu.status = 'active'))`;

/**
 * Os sons das tchekas: o som original tirado de cada tcheka com som próprio, o som de cada faixa do catálogo e dos artistas,
 * usar um som numa tcheka nova, «Sons em alta», as denúncias de direitos e a definição «Deixar usar o meu som».
 * As tchekas de um som (a grelha da página) vêm do PostsService (bySound), com as mesmas regras de visibilidade do resto.
 */
@Injectable()
export class SoundsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Sounds');
  private chain: Promise<void> = Promise.resolve();
  private backfillTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly media: MediaService,
    private readonly catalog: MusicCatalogService,
  ) {}

  onModuleInit() {
    // As tchekas publicadas antes dos sons: tira-se o som aos poucos, um minuto depois do arranque (nunca nos testes).
    if (this.config.NODE_ENV === 'test') return;
    this.backfillTimer = setTimeout(() => void this.backfill().catch((e) => this.log.warn(`sons antigos: ${(e as Error).message}`)), 60_000);
    this.backfillTimer.unref?.();
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.backfillTimer) clearTimeout(this.backfillTimer);
  }

  // ------------------------------------------------------------------ publicar

  /**
   * Publicar uma tcheka com `soundId` («Usar este som»): valida o som e devolve o que fica guardado na publicação (`music`) e
   * o som a ligar. Só em tchekas. Um som original só se usa se existir para quem publica, não estiver em análise e o autor
   * deixar (ou for o próprio autor). Uma faixa do catálogo ou de um artista passa pelas mesmas regras de quando se escolhe no
   * seletor (escondidas e indisponíveis recusadas; a faixa local conta o uso para o artista).
   */
  async prepareUse(userId: string, soundId: string, musicIn: MusicInput | null, opts: { tcheka: boolean }): Promise<{ soundId: string; music: Record<string, unknown> }> {
    const ref = parseSoundId(soundId);
    if (!ref) throw new BadRequestException('Som inválido');
    if (!opts.tcheka) throw new BadRequestException('Os sons só se usam em tchekas (uma publicação com um só vídeo)');
    if (ref.kind === 'original') {
      if (musicIn) throw new BadRequestException('Uma tcheka leva um som ou uma música, não os dois');
      const r = (
        await this.pool.query(
          `SELECT s.id, s.audio_media_id, s.duration_ms, s.cover_media_id, s.hold_at, s.owner_id, ou.username, ou.display_name, ${REUSABLE()} AS reusable
             FROM content.sounds s JOIN identity.users ou ON ou.id = s.owner_id
            WHERE s.id = $2 AND s.kind = 'original' AND ${SOUND_VISIBLE()}`,
          [userId, ref.id],
        )
      ).rows[0];
      if (!r || !r.audio_media_id) throw new NotFoundException('Este som já não está disponível');
      const mine = r.owner_id === userId;
      if (r.hold_at) throw new ForbiddenException('Este som está em análise e não pode ser usado agora');
      if (!mine && !r.reusable) throw new ForbiddenException('Quem publicou este som não deixa usá-lo');
      return {
        soundId: ref.id,
        music: {
          kind: 'sound',
          id: `sound:${ref.id}`,
          soundId: ref.id,
          audioMediaId: r.audio_media_id as string,
          title: originalTitle(r.username as string),
          artist: r.display_name as string,
          durationMs: (r.duration_ms as number | null) ?? null,
          cover: r.cover_media_id ? `/api/v1/media/${r.cover_media_id as string}?poster=1` : null,
        },
      };
    }
    // Faixa: se a app mandou também a música, tem de ser a mesma.
    if (musicIn) {
      if ('kind' in musicIn) throw new BadRequestException('Uma tcheka leva um som ou uma música, não os dois');
      const sent = 'source' in musicIn && musicIn.source === 'local' && !musicIn.id.startsWith('local:') ? `local:${musicIn.id}` : musicIn.id;
      if (sent !== ref.trackId) throw new BadRequestException('Uma tcheka leva um som ou uma música, não os dois');
    }
    let music: Record<string, unknown>;
    if (ref.kind === 'local') {
      music = await this.catalog.prepareLocalUse(userId, ref.trackId, 'post');
    } else {
      const c = await this.catalog.canonical(ref.trackId);
      if (!c.found) throw new NotFoundException('Esta música já não está disponível');
      music = storedTrack(c.track);
      this.catalog.invalidate(); // «Em alta» conta já este uso
    }
    const linked = await this.ensureTrackSound(music);
    if (!linked) throw new NotFoundException('Esta música já não está disponível');
    return { soundId: linked, music };
  }

  /**
   * O som de uma faixa guardada numa tcheka (o que o MusicService.prepare devolve): cria a linha no primeiro uso. Só faixas do
   * catálogo curado e dos artistas; clipes próprios, música licenciada e faixas antigas (antes do catálogo) não têm som.
   */
  async ensureTrackSound(stored: Record<string, unknown> | null): Promise<string | null> {
    if (!stored || 'kind' in stored || typeof stored.id !== 'string') return null;
    const source = String(stored.source ?? '');
    const local = source === 'local' && stored.id.startsWith('local:');
    if (!local && !CATALOG_SOURCES.has(source)) return null;
    const id = soundIdOfTrack(stored.id);
    if (!parseSoundId(id)) return null;
    const title = String(stored.title ?? '').slice(0, 160) || 'Sem título';
    const owner = local && typeof stored.artistUsername === 'string'
      ? ((await this.pool.query('SELECT id FROM identity.users WHERE username = $1', [stored.artistUsername])).rows[0]?.id as string | undefined) ?? null
      : null;
    const durationMs = typeof stored.durationMs === 'number' && stored.durationMs > 0 ? Math.round(stored.durationMs) : null;
    await this.pool.query(
      `INSERT INTO content.sounds (id, kind, owner_id, track_id, track, title, duration_ms) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET track = EXCLUDED.track, title = EXCLUDED.title, duration_ms = EXCLUDED.duration_ms, owner_id = COALESCE(EXCLUDED.owner_id, content.sounds.owner_id)`,
      [id, local ? 'local' : 'catalog', owner, stored.id, JSON.stringify(stored), title, durationMs],
    );
    return id;
  }

  /**
   * Depois de publicar uma tcheka sem música escolhida: tira o som do vídeo em segundo plano (um de cada vez). Publicações feitas
   * como um local não dão som original (o som diria quem é o gestor que publicou).
   */
  queueOriginal(postId: string): Promise<void> {
    this.chain = this.chain.then(() => this.extract(postId)).catch((e) => this.log.warn(`som da tcheka ${postId}: ${(e as Error).message}`));
    return this.chain;
  }

  /** Espera que os sons em fila acabem (testes). */
  idle(): Promise<void> {
    return this.chain;
  }

  /** As tchekas antigas, sem som visto: as mais recentes primeiro, aos poucos. */
  async backfill(max = 300): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT p.id FROM content.posts p
        WHERE p.kind = 'post' AND p.removed_at IS NULL AND p.music IS NULL AND p.sound_id IS NULL AND p.sound_checked_at IS NULL AND p.venue_id IS NULL
          AND p.created_at > now() - interval '180 days'
          AND (SELECT count(*) = 1 AND bool_and(ma.mime LIKE 'video/%') FROM content.post_media pm JOIN content.media_assets ma ON ma.id = pm.media_id WHERE pm.post_id = p.id)
        ORDER BY p.id DESC LIMIT $1`,
      [max],
    );
    for (const r of rows) {
      if (this.stopped) break;
      await this.queueOriginal(r.id as string);
    }
    return rows.length;
  }

  private async extract(postId: string): Promise<void> {
    const p = (
      await this.pool.query(
        `SELECT p.author_id, u.username, pm.media_id, ma.duration_ms
           FROM content.posts p JOIN identity.users u ON u.id = p.author_id
           JOIN content.post_media pm ON pm.post_id = p.id JOIN content.media_assets ma ON ma.id = pm.media_id
          WHERE p.id = $1 AND p.removed_at IS NULL AND p.music IS NULL AND p.sound_id IS NULL AND p.venue_id IS NULL AND p.kind = 'post'
            AND u.status = 'active' AND ma.status = 'ready' AND ma.mime LIKE 'video/%'
            AND (SELECT count(*) FROM content.post_media x WHERE x.post_id = p.id) = 1`,
        [postId],
      )
    ).rows[0];
    const checked = () => this.pool.query('UPDATE content.posts SET sound_checked_at = now() WHERE id = $1', [postId]);
    if (!p) return void (await checked());
    const dir = await mkdtemp(join(tmpdir(), 'txill-som-'));
    let audioId: string | null = null;
    try {
      const src = join(dir, 'in.mp4');
      const out = join(dir, 'som.m4a');
      await writeFile(src, await this.media.rawBytes(p.media_id as string, 'public'));
      const seconds = await this.audioSeconds(src);
      if (!seconds || (await this.peakDb(src)) <= SILENT_DB) return void (await checked());
      const len = Math.min(seconds, SOUND_MAX_MS / 1000);
      await run(
        FFMPEG,
        ['-y', ...VideoService.SAFE_INPUT, '-i', src, '-t', len.toFixed(3), '-vn', '-map_metadata', '-1',
          '-af', `afade=t=out:st=${Math.max(0, len - 0.4).toFixed(3)}:d=0.4`, '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', out],
        { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      );
      const durationMs = Math.round(len * 1000);
      audioId = await this.media.storeDerived(p.author_id as string, await readFile(out), 'audio/mp4', 'music', durationMs);
      const id = uuidv7();
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        // A tcheka pode ter sido apagada (ou ganho um som) enquanto o áudio se preparava.
        const still = await client.query(`SELECT 1 FROM content.posts WHERE id = $1 AND removed_at IS NULL AND sound_id IS NULL FOR UPDATE`, [postId]);
        if (!still.rowCount) {
          await client.query('ROLLBACK');
          await this.pool.query(`UPDATE content.media_assets SET status = 'deleted' WHERE id = $1`, [audioId]);
          return;
        }
        await client.query(
          `INSERT INTO content.sounds (id, kind, owner_id, source_post_id, title, audio_media_id, cover_media_id, duration_ms)
           VALUES ($1, 'original', $2, $3, $4, $5, $6, $7)`,
          [id, p.author_id, postId, originalTitle(p.username as string), audioId, p.media_id, durationMs],
        );
        await client.query('UPDATE content.posts SET sound_id = $2, sound_checked_at = now() WHERE id = $1', [postId, id]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        await this.pool.query(`UPDATE content.media_assets SET status = 'deleted' WHERE id = $1`, [audioId]);
        throw e;
      } finally {
        client.release();
      }
    } catch (e) {
      await checked().catch(() => undefined);
      throw e;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Segundos de áudio do vídeo (0 sem pista de áudio). */
  private async audioSeconds(file: string): Promise<number> {
    const { stdout } = await run(ffprobe.path, ['-v', 'error', ...VideoService.SAFE_INPUT, '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 30_000 });
    const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type: string; duration?: string }[] };
    const a = info.streams?.find((s) => s.codec_type === 'audio');
    if (!a) return 0;
    const s = Number(a.duration ?? info.format?.duration ?? 0);
    return Number.isFinite(s) && s >= 0.5 ? s : 0;
  }

  /** O pico do áudio em dB (volumedetect). -91 dB = silêncio digital. */
  private async peakDb(file: string): Promise<number> {
    const { stderr } = await run(FFMPEG, ['-hide_banner', '-nostats', ...VideoService.SAFE_INPUT, '-i', file, '-t', String(SOUND_MAX_MS / 1000), '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
    const m = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(String(stderr));
    if (!m) return -Infinity;
    return m[1] === '-inf' ? -Infinity : Number(m[1]);
  }

  // ------------------------------------------------------------------ ler

  private uses(id: string): Promise<number> {
    return this.pool
      .query(
        `SELECT count(*)::int AS n FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND u.status = 'active'
          WHERE p.sound_id = $1 AND p.removed_at IS NULL`,
        [id],
      )
      .then((r) => r.rows[0].n as number);
  }

  private author(r: Record<string, any>): SoundAuthor | undefined {
    if (!r.a_username || r.a_status !== 'active') return undefined;
    return { username: r.a_username as string, displayName: r.a_display_name as string, ...badge(r.a_verified, r.a_tier) };
  }

  /** A página de um som (GET /sounds/:id). 404 quando o som não existe para quem está a ver. */
  async get(viewerId: string, id: string): Promise<SoundDto> {
    const ref = parseSoundId(id);
    if (!ref) throw new NotFoundException('Som não encontrado');
    if (ref.kind === 'original') {
      const r = (
        await this.pool.query(
          `SELECT s.*, ou.username AS a_username, ou.display_name AS a_display_name, ou.verified AS a_verified, ou.verified_tier AS a_tier, ou.status AS a_status,
                  ou.is_private, ou.sound_reuse, (ou.birth_date <= (current_date - interval '18 years')) AS adult, (ou.terms_version >= '${SOUND_TERMS}') AS terms_ok, ${REUSABLE()} AS reusable,
                  sp.short_code AS source_code
             FROM content.sounds s JOIN identity.users ou ON ou.id = s.owner_id LEFT JOIN content.posts sp ON sp.id = s.source_post_id
            WHERE s.id = $2 AND s.kind = 'original' AND ${SOUND_VISIBLE()}`,
          [viewerId, ref.id],
        )
      ).rows[0];
      if (!r) throw new NotFoundException('Som não encontrado');
      const mine = r.owner_id === viewerId;
      const unavailable: SoundDto['unavailable'] = r.hold_at ? 'held' : mine || r.reusable ? undefined : r.is_private ? 'private' : !r.sound_reuse || (r.adult && !r.terms_ok) ? 'off' : 'minor';
      return {
        id: r.id,
        kind: 'original',
        title: originalTitle(r.a_username as string),
        author: this.author(r),
        cover: r.cover_media_id ? `/api/v1/media/${r.cover_media_id as string}?poster=1` : null,
        durationMs: (r.duration_ms as number | null) ?? null,
        previewUrl: r.audio_media_id ? this.media.soundUrl(r.audio_media_id as string) : null,
        uses: await this.uses(r.id),
        createdAt: new Date(r.created_at as string).toISOString(),
        canUse: !unavailable && !!r.audio_media_id,
        ...(unavailable ? { unavailable } : {}),
        mine,
        sourcePost: r.source_post_id ? { id: r.source_post_id as string, code: r.source_code as string } : null,
      };
    }
    // Faixa do catálogo ou de um artista: o que o catálogo sabe agora, e a linha do som (se já foi usada numa tcheka).
    const row = (
      await this.pool.query(
        `SELECT s.*, ou.username AS a_username, ou.display_name AS a_display_name, ou.verified AS a_verified, ou.verified_tier AS a_tier, ou.status AS a_status
           FROM content.sounds s LEFT JOIN identity.users ou ON ou.id = s.owner_id WHERE s.id = $1`,
        [ref.id],
      )
    ).rows[0];
    if (row?.removed_at) throw new NotFoundException('Som não encontrado');
    const [found] = await this.catalog.enrich([{ id: ref.trackId }]);
    const pick = found && 'previewUrl' in found ? (found as PickerTrack) : null;
    if (!pick && !row) throw new NotFoundException('Som não encontrado');
    const track = (row?.track ?? {}) as Record<string, unknown>;
    let author = row ? this.author(row) : undefined;
    if (!author && pick?.artistUsername) {
      const a = (await this.pool.query(`SELECT username AS a_username, display_name AS a_display_name, verified AS a_verified, verified_tier AS a_tier, status AS a_status FROM identity.users WHERE username = $1`, [pick.artistUsername])).rows[0];
      if (a) author = this.author(a);
    }
    const cover = pick?.cover ?? (typeof track.cover === 'string' ? track.cover : track.coverMediaId ? `/api/v1/media/${String(track.coverMediaId)}?w=480` : null);
    return {
      id: ref.id,
      kind: ref.kind,
      title: pick?.title ?? (row.title as string),
      ...(author ? { author } : {}),
      artist: pick?.artist ?? (typeof track.artist === 'string' ? track.artist : ''),
      cover,
      durationMs: pick?.durationMs ?? (row?.duration_ms as number | null) ?? null,
      previewUrl: pick?.previewUrl ?? null,
      uses: row ? await this.uses(ref.id) : 0,
      createdAt: row ? new Date(row.created_at as string).toISOString() : null,
      ...(pick ? { music: pick } : {}),
      canUse: !!pick,
      ...(pick ? {} : { unavailable: 'unavailable' as const }),
      mine: false,
      sourcePost: null,
    };
  }

  /** Confirma que o som existe para quem está a ver (para a grelha das tchekas). */
  async assertVisible(viewerId: string, id: string): Promise<SoundRef> {
    const ref = parseSoundId(id);
    if (!ref) throw new NotFoundException('Som não encontrado');
    if (ref.kind === 'original') {
      const ok = await this.pool.query(
        `SELECT 1 FROM content.sounds s JOIN identity.users ou ON ou.id = s.owner_id WHERE s.id = $2 AND s.kind = 'original' AND ${SOUND_VISIBLE()}`,
        [viewerId, ref.id],
      );
      if (!ok.rowCount) throw new NotFoundException('Som não encontrado');
    } else {
      const r = (await this.pool.query('SELECT removed_at FROM content.sounds WHERE id = $1', [ref.id])).rows[0];
      if (r?.removed_at) throw new NotFoundException('Som não encontrado');
    }
    return ref;
  }

  /**
   * «Sons em alta»: os sons com mais tchekas nos últimos 7 dias (só números agregados). Fora: os sons em análise ou tirados, os
   * originais que o autor não deixa usar (ou de contas privadas e de menores), os de quem eu não posso ver e os de fora da minha
   * rede (como na descoberta: o meu país e quem sigo), e as faixas que já saíram do catálogo.
   */
  async trending(viewerId: string, limit = 20): Promise<TrendingSound[]> {
    const { rows } = await this.pool.query(
      `WITH u AS (
         SELECT p.sound_id, count(*)::int AS n FROM content.posts p JOIN identity.users pu ON pu.id = p.author_id AND pu.status = 'active'
          WHERE p.sound_id IS NOT NULL AND p.removed_at IS NULL AND p.created_at > now() - interval '7 days'
          GROUP BY p.sound_id ORDER BY count(*) DESC LIMIT 200)
       SELECT s.*, u.n AS uses7d,
              (SELECT count(*) FROM content.posts ap JOIN identity.users au ON au.id = ap.author_id AND au.status = 'active' WHERE ap.sound_id = s.id AND ap.removed_at IS NULL)::int AS uses,
              ou.username AS a_username, ou.display_name AS a_display_name, ou.verified AS a_verified, ou.verified_tier AS a_tier, ou.status AS a_status
         FROM u JOIN content.sounds s ON s.id = u.sound_id LEFT JOIN identity.users ou ON ou.id = s.owner_id
        WHERE s.hold_at IS NULL AND ${SOUND_VISIBLE()}
          AND (s.kind <> 'original' OR (s.audio_media_id IS NOT NULL AND (ou.id = $1 OR ${REUSABLE()}) AND ${inMyNetwork('ou.id', 'ou.country')}))
        ORDER BY u.n DESC, s.created_at DESC LIMIT $2`,
      [viewerId, Math.min(limit * 2, 80)],
    );
    const tracks = rows.filter((r) => r.kind !== 'original');
    const picks = new Map<string, PickerTrack>();
    for (const t of await this.catalog.enrich(tracks.map((r) => ({ id: r.track_id as string })))) if ('previewUrl' in t) picks.set(t.id, t as PickerTrack);
    const out: TrendingSound[] = [];
    for (const r of rows) {
      const author = this.author(r);
      if (r.kind === 'original') {
        out.push({
          id: r.id, kind: 'original', title: originalTitle(r.a_username as string), ...(author ? { author } : {}),
          cover: r.cover_media_id ? `/api/v1/media/${r.cover_media_id as string}?poster=1` : null,
          durationMs: (r.duration_ms as number | null) ?? null, previewUrl: this.media.soundUrl(r.audio_media_id as string),
          uses: r.uses as number, uses7d: r.uses7d as number, createdAt: new Date(r.created_at as string).toISOString(),
        });
        continue;
      }
      const pick = picks.get(r.track_id as string);
      if (!pick) continue; // saiu do catálogo ou está escondida
      out.push({
        id: r.id, kind: r.kind as SoundKind, title: pick.title, ...(author ? { author } : {}), artist: pick.artist,
        cover: pick.cover, durationMs: pick.durationMs, previewUrl: pick.previewUrl,
        uses: r.uses as number, uses7d: r.uses7d as number, createdAt: new Date(r.created_at as string).toISOString(),
      });
    }
    return out.slice(0, limit);
  }

  // ------------------------------------------------------------------ definições

  /** «Deixar usar o meu som»: `reuse` é o que a pessoa escolheu; `effective` é o que vale (conta privada ou de menor: desligado). */
  async settings(userId: string) {
    const r = (
      await this.pool.query(
        `SELECT sound_reuse, is_private, (birth_date <= (current_date - interval '18 years')) AS adult FROM identity.users WHERE id = $1`,
        [userId],
      )
    ).rows[0];
    if (!r) throw new NotFoundException();
    return { reuse: !!r.sound_reuse, effective: !!r.sound_reuse && !r.is_private && !!r.adult, private: !!r.is_private, minor: !r.adult };
  }

  async setSettings(userId: string, reuse: boolean) {
    await this.pool.query('UPDATE identity.users SET sound_reuse = $2 WHERE id = $1', [userId, reuse]);
    return this.settings(userId);
  }

  /** Os meus sons originais (Definições, exportação). */
  async mine(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT s.id, s.duration_ms, s.cover_media_id, s.created_at, s.hold_at, s.removed_at, sp.short_code AS code, (sp.removed_at IS NOT NULL) AS source_removed,
              (SELECT count(*) FROM content.posts p WHERE p.sound_id = s.id AND p.removed_at IS NULL)::int AS uses
         FROM content.sounds s LEFT JOIN content.posts sp ON sp.id = s.source_post_id
        WHERE s.owner_id = $1 AND s.kind = 'original' ORDER BY s.created_at DESC LIMIT 200`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id as string,
      cover: r.cover_media_id ? `/api/v1/media/${r.cover_media_id as string}?poster=1` : null,
      durationMs: (r.duration_ms as number | null) ?? null,
      uses: r.uses as number,
      createdAt: new Date(r.created_at as string).toISOString(),
      status: (r.removed_at ? 'removed' : r.source_removed ? 'source_removed' : r.hold_at ? 'held' : 'active') as 'removed' | 'source_removed' | 'held' | 'active',
      sourceCode: (r.code as string | null) ?? null,
    }));
  }

  // ------------------------------------------------------------------ áudio

  /** Servir o áudio de um som original (URL assinado): só se o som não foi tirado e a conta do autor está ativa. */
  async audio(mediaId: string, exp: number, sig: string): Promise<Served> {
    const found = await this.media.locateSound(mediaId, exp, sig);
    const ok = await this.pool.query(
      `SELECT 1 FROM content.sounds s JOIN identity.users u ON u.id = s.owner_id WHERE s.audio_media_id = $1 AND s.removed_at IS NULL AND u.status = 'active'`,
      [mediaId],
    );
    if (!ok.rowCount) throw new NotFoundException();
    return found;
  }

  // ------------------------------------------------------------------ denúncias

  /**
   * Denunciar um som original («Este som tem música protegida», ou outro motivo). Fica logo escondido para novos usos (continua a
   * tocar nas tchekas que já o usam) até a equipa decidir no backoffice. Só sons originais; as faixas dos artistas têm a denúncia
   * de direitos delas (POST /music/local/:id/report) e as do catálogo saem pelo backoffice.
   */
  async report(userId: string, id: string, reason: 'copyright' | 'other', note?: string) {
    const ref = parseSoundId(id);
    if (!ref) throw new NotFoundException('Som não encontrado');
    if (ref.kind !== 'original') throw new BadRequestException('As músicas do catálogo e dos artistas denunciam-se na própria faixa');
    const r = (
      await this.pool.query(
        `SELECT s.owner_id FROM content.sounds s JOIN identity.users ou ON ou.id = s.owner_id WHERE s.id = $2 AND s.kind = 'original' AND ${SOUND_VISIBLE()}`,
        [userId, ref.id],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Som não encontrado');
    if (r.owner_id === userId) throw new BadRequestException('Não podes denunciar o teu próprio som');
    await this.pool.query(
      `INSERT INTO content.sound_reports (id, sound_id, reporter_id, reason, note) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (sound_id, reporter_id) DO NOTHING`,
      [uuidv7(), ref.id, userId, reason, note?.trim() || null],
    );
    await this.pool.query(
      `UPDATE content.sounds SET hold_at = now() WHERE id = $1 AND hold_at IS NULL AND EXISTS (SELECT 1 FROM content.sound_reports r WHERE r.sound_id = $1 AND r.status = 'open')`,
      [ref.id],
    );
  }

  /** Backoffice: os sons denunciados (por analisar, decididos ou tirados), com o áudio para ouvir. */
  async adminList(status: 'open' | 'upheld' | 'dismissed' | 'all' = 'open') {
    const { rows } = await this.pool.query(
      `SELECT s.id, s.title, s.duration_ms, s.cover_media_id, s.audio_media_id, s.hold_at, s.removed_at, s.removed_reason, s.created_at,
              ou.id AS owner_id, ou.username, ou.display_name, ou.status AS owner_status, ou.is_private,
              sp.id AS post_id, sp.short_code AS post_code, (sp.removed_at IS NOT NULL) AS post_removed,
              (SELECT count(*) FROM content.posts p WHERE p.sound_id = s.id AND p.removed_at IS NULL)::int AS uses,
              json_agg(json_build_object('reason', r.reason, 'note', r.note, 'status', r.status, 'at', r.created_at, 'decisionReason', r.decision_reason) ORDER BY r.created_at) AS reports,
              count(*) FILTER (WHERE r.status = 'open')::int AS open, max(r.created_at) AS last_at
         FROM content.sound_reports r JOIN content.sounds s ON s.id = r.sound_id
         LEFT JOIN identity.users ou ON ou.id = s.owner_id LEFT JOIN content.posts sp ON sp.id = s.source_post_id
        GROUP BY s.id, ou.id, sp.id
       HAVING $1 = 'all' OR ($1 = 'open' AND count(*) FILTER (WHERE r.status = 'open') > 0) OR ($1 <> 'open' AND bool_or(r.status = $1))
        ORDER BY max(r.created_at) DESC LIMIT 200`,
      [status],
    );
    return rows.map((r) => ({
      id: r.id as string,
      title: r.username ? originalTitle(r.username as string) : (r.title as string),
      owner: r.owner_id ? { id: r.owner_id as string, username: r.username as string, displayName: r.display_name as string, status: r.owner_status as string, isPrivate: !!r.is_private } : null,
      durationMs: (r.duration_ms as number | null) ?? null,
      cover: r.cover_media_id ? `/api/v1/media/${r.cover_media_id as string}?poster=1` : null,
      previewUrl: r.audio_media_id ? this.media.soundUrl(r.audio_media_id as string) : null,
      post: r.post_id ? { id: r.post_id as string, code: r.post_code as string, removed: !!r.post_removed } : null,
      uses: r.uses as number,
      status: (r.removed_at ? 'removed' : r.hold_at ? 'held' : 'active') as 'removed' | 'held' | 'active',
      removedReason: (r.removed_reason as string | null) ?? null,
      open: r.open as number,
      reports: (r.reports as { reason: string; note: string | null; status: string; at: string; decisionReason: string | null }[]),
      lastAt: new Date(r.last_at as string).toISOString(),
      createdAt: new Date(r.created_at as string).toISOString(),
    }));
  }

  /**
   * Decidir: `uphold` (tem música protegida: o som é tirado e deixa de tocar em todas as tchekas, também nas antigas; o vídeo de
   * onde saiu fica, a Moderação tira-o à parte se for preciso), `dismiss` (sem razão: volta a poder ser usado) ou `restore`
   * (repor um som tirado). Fica na auditoria.
   */
  async decide(actor: string, id: string, action: 'uphold' | 'dismiss' | 'restore', reason: string) {
    const s = (await this.pool.query(`SELECT id, kind, hold_at, removed_at FROM content.sounds WHERE id = $1`, [id])).rows[0];
    if (!s || s.kind !== 'original') throw new NotFoundException('Som não encontrado');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (action === 'uphold') {
        await client.query(`UPDATE content.sounds SET removed_at = now(), removed_reason = $2, hold_at = NULL WHERE id = $1`, [id, reason]);
        await client.query(`UPDATE content.sound_reports SET status = 'upheld', decided_by = $2, decided_at = now(), decision_reason = $3 WHERE sound_id = $1 AND status = 'open'`, [id, actor, reason]);
      } else if (action === 'dismiss') {
        await client.query(`UPDATE content.sounds SET hold_at = NULL WHERE id = $1`, [id]);
        await client.query(`UPDATE content.sound_reports SET status = 'dismissed', decided_by = $2, decided_at = now(), decision_reason = $3 WHERE sound_id = $1 AND status = 'open'`, [id, actor, reason]);
      } else {
        if (!s.removed_at) throw new BadRequestException('Este som não foi tirado');
        await client.query(`UPDATE content.sounds SET removed_at = NULL, removed_reason = NULL, hold_at = NULL WHERE id = $1`, [id]);
      }
      await client.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
        uuidv7(), actor, { uphold: 'sound.remove', dismiss: 'sound.dismiss', restore: 'sound.restore' }[action], `sound:${id}`, { reason },
      ]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}

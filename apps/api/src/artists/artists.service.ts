import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Pool, PoolClient } from 'pg';
import { promisify } from 'util';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { MediaService, type Served } from '../media/media.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MUSIC_LICENSE_SHA256, MUSIC_LICENSE_VERSION, musicLicense } from './license';

const run = promisify(execFile);
const FFMPEG = (ffmpegPath as unknown as string | null) ?? 'ffmpeg';
/** Só ficheiros locais e só os formatos de áudio aceites (MP3, AAC solto e MP4/M4A): o ffmpeg não vai buscar mais nada. */
const SAFE_AUDIO = ['-protocol_whitelist', 'file', '-format_whitelist', 'mp3,aac,mov,mp4,m4a'];

/** Estilos (para filtrar no seletor e no pedido). Os de Moçambique primeiro. */
export const ARTIST_STYLES = [
  'marrabenta', 'pandza', 'dzukuta', 'passada', 'kizomba', 'afro-house', 'amapiano', 'hip hop', 'rnb', 'afrobeats',
  'gospel', 'zouk', 'reggae', 'jazz', 'pop', 'rock', 'tradicional', 'outro',
] as const;
export type ArtistStyle = (typeof ARTIST_STYLES)[number];

/** Onde o artista está: redes e plataformas de streaming. */
export const LINK_KINDS = ['instagram', 'facebook', 'tiktok', 'youtube', 'spotify', 'apple_music', 'audiomack', 'boomplay', 'deezer', 'site'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** Limites do áudio: a faixa inteira tem de ter entre 15 s e 15 min; o trecho que se usa, entre 10 e 60 s. */
export const TRACK_LIMITS = { minTrackMs: 15_000, maxTrackMs: 15 * 60_000, minPreviewMs: 10_000, maxPreviewMs: 60_000 } as const;

/** Contacto para direitos de autor (está também na Ajuda e na licença). */
export const RIGHTS_CONTACT = 'suporte@txillapp.com';

export interface ApplyInput {
  stageName: string;
  styles: string[];
  links: { kind: LinkKind; url: string }[];
  rightsKind: 'label' | 'self';
  labelName?: string;
  rightsStatement: string;
  proofMediaId?: string;
}
export interface TrackInput {
  title: string;
  audioMediaId: string;
  coverMediaId?: string;
  styles: string[];
  previewStartMs: number;
  previewMs: number;
  explicit: boolean;
  licenseVersion: string;
  acceptLicense: true;
}
export interface ClaimInput { claimantName: string; contactEmail: string; relation: 'owner' | 'label' | 'representative' | 'other'; details: string }

/**
 * A faixa como o seletor e as publicações a mostram: a interface comum das faixas (docs/musica.md), `source: 'local'`, com os
 * campos antigos (`url`, `durationMs`, `landing`, `licenseUrl`) para as versões da app que ainda os leem.
 */
export interface LocalTrack {
  source: 'local';
  id: string;
  trackId: string;
  title: string;
  artist: string;
  artistUsername: string | null;
  duration: number;
  durationMs: number;
  previewUrl: string;
  url: string;
  cover: string | null;
  license: 'txillapp';
  licenseUrl: null;
  landing: null;
  styles: string[];
  explicit: boolean;
}

/** O que fica guardado na publicação ou no mimo (a "fotografia" da faixa no momento do uso). */
interface Snapshot {
  source: 'local';
  id: string;
  trackId: string;
  title: string;
  artist: string;
  artistUsername: string | null;
  previewMediaId: string;
  coverMediaId: string | null;
  durationMs: number;
  styles: string[];
  explicit: boolean;
  license: 'txillapp';
}

const cleanStyles = (list: string[]) => {
  const out = [...new Set(list.map((s) => s.trim().toLowerCase()))];
  if (out.some((s) => !(ARTIST_STYLES as readonly string[]).includes(s))) throw new BadRequestException('Estilo desconhecido');
  if (!out.length) throw new BadRequestException('Escolhe pelo menos um estilo');
  if (out.length > 5) throw new BadRequestException('No máximo 5 estilos');
  return out;
};

const localId = (trackId: string) => `local:${trackId}`;
/** Aceita `local:<uuid>` ou só o uuid. */
export const parseLocalId = (id: string) => {
  const raw = id.startsWith('local:') ? id.slice(6) : id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(raw)) throw new BadRequestException('Faixa inválida');
  return raw;
};

/** A faixa está disponível para novos usos: aprovada, sem denúncia aberta, de um artista aprovado e com a conta ativa. */
const AVAILABLE = (t = 't') =>
  `${t}.status = 'approved' AND ${t}.hold_at IS NULL AND ${t}.preview_media_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM content.artist_profiles ap JOIN identity.users au ON au.id = ap.user_id WHERE ap.user_id = ${t}.artist_id AND ap.status = 'approved' AND au.status = 'active')`;

/** Menor de 18 anos (ou sem data de nascimento): não vê nem usa faixas explícitas. */
const MINOR = `NOT EXISTS (SELECT 1 FROM identity.users mu WHERE mu.id = $1 AND mu.birth_date <= (current_date - interval '18 years'))`;

@Injectable()
export class ArtistsService {
  private readonly log = new Logger('Artists');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly media: MediaService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ───────────── o pedido de artista ───────────── */

  /** O meu estado no programa (e o que a app precisa para os formulários: estilos, tipos de ligação, licença, limites). */
  async me(userId: string) {
    const r = (await this.pool.query('SELECT * FROM content.artist_profiles WHERE user_id = $1', [userId])).rows[0];
    return {
      artist: r ? this.artistRow(r) : null,
      license: musicLicense(),
      styles: ARTIST_STYLES,
      linkKinds: LINK_KINDS,
      limits: TRACK_LIMITS,
      rightsContact: RIGHTS_CONTACT,
    };
  }

  private artistRow(r: Record<string, unknown>) {
    return {
      status: r.status as string,
      stageName: r.stage_name as string,
      styles: (r.styles as string[]) ?? [],
      links: (r.links as { kind: string; url: string }[]) ?? [],
      rightsKind: r.rights_kind as 'label' | 'self',
      labelName: (r.label_name as string | null) ?? null,
      rightsStatement: r.rights_statement as string,
      hasProof: !!r.proof_media_id,
      reason: (r.review_reason as string | null) ?? null,
      createdAt: r.created_at as string,
      reviewedAt: (r.reviewed_at as string | null) ?? null,
    };
  }

  /** Pedir (ou voltar a pedir depois de recusado ou retirado). Fica à espera da equipa. */
  async apply(userId: string, b: ApplyInput) {
    const cur = (await this.pool.query('SELECT status, proof_media_id FROM content.artist_profiles WHERE user_id = $1', [userId])).rows[0];
    if (cur?.status === 'approved') throw new ConflictException('Esta conta já é de artista');
    if (cur?.status === 'revoked') throw new ForbiddenException('A equipa tirou o estatuto de artista a esta conta. Escreve para ' + RIGHTS_CONTACT);
    if (b.rightsKind === 'label' && !b.labelName?.trim()) throw new BadRequestException('Diz o nome da editora');
    if (b.proofMediaId) {
      const ok = await this.pool.query(`SELECT 1 FROM content.media_assets WHERE id = $1 AND owner_id = $2 AND purpose = 'chat' AND status = 'ready' AND mime LIKE 'image/%'`, [b.proofMediaId, userId]);
      if (!ok.rowCount) throw new BadRequestException('A prova tem de ser uma foto (JPEG, PNG ou WebP)');
    }
    const styles = cleanStyles(b.styles);
    await this.pool.query(
      `INSERT INTO content.artist_profiles (user_id, stage_name, styles, links, rights_kind, label_name, rights_statement, proof_media_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       ON CONFLICT (user_id) DO UPDATE SET stage_name = EXCLUDED.stage_name, styles = EXCLUDED.styles, links = EXCLUDED.links, rights_kind = EXCLUDED.rights_kind,
         label_name = EXCLUDED.label_name, rights_statement = EXCLUDED.rights_statement, proof_media_id = EXCLUDED.proof_media_id, status = 'pending',
         review_reason = NULL, reviewed_by = NULL, reviewed_at = NULL, updated_at = now()`,
      [userId, b.stageName.trim(), styles, JSON.stringify(b.links), b.rightsKind, b.rightsKind === 'label' ? b.labelName!.trim() : null, b.rightsStatement.trim(), b.proofMediaId ?? null],
    );
    // A prova antiga (de um pedido anterior) deixa de ser precisa.
    if (cur?.proof_media_id && cur.proof_media_id !== b.proofMediaId) await this.dropMedia([cur.proof_media_id as string]);
    return (await this.me(userId)).artist;
  }

  /** Retirar o pedido enquanto está à espera (a prova apaga-se). */
  async withdrawApplication(userId: string) {
    const r = await this.pool.query(`UPDATE content.artist_profiles SET status = 'withdrawn', updated_at = now() WHERE user_id = $1 AND status = 'pending' RETURNING proof_media_id`, [userId]);
    if (!r.rowCount) throw new NotFoundException('Não tens nenhum pedido à espera');
    await this.dropMedia([r.rows[0].proof_media_id]);
  }

  private async dropMedia(ids: (string | null | undefined)[]) {
    const list = ids.filter((x): x is string => !!x);
    if (list.length) await this.pool.query(`UPDATE content.media_assets SET status = 'deleted' WHERE id = ANY($1) AND status <> 'deleted'`, [list]);
  }

  private async approvedArtist(userId: string) {
    const r = (await this.pool.query(`SELECT stage_name FROM content.artist_profiles WHERE user_id = $1 AND status = 'approved'`, [userId])).rows[0];
    if (!r) throw new ForbiddenException('Só artistas aprovados podem carregar músicas');
    return r.stage_name as string;
  }

  /* ───────────── carregar e gerir as faixas ───────────── */

  /**
   * Carregar uma faixa: o áudio (já enviado como 'music'), o título, a capa, os estilos, o trecho a usar e se é explícita.
   * É preciso aceitar a versão atual da licença (fica o registo de quem, quando e que texto). O servidor confirma a duração e
   * corta o trecho (o original nunca é servido). A faixa fica à espera da moderação.
   */
  async createTrack(userId: string, b: TrackInput) {
    await this.approvedArtist(userId);
    if (b.acceptLicense !== true) throw new BadRequestException('Tens de aceitar a licença para publicar');
    if (b.licenseVersion !== MUSIC_LICENSE_VERSION) throw new ConflictException('A licença mudou entretanto. Lê a versão nova e aceita outra vez');
    const styles = cleanStyles(b.styles);
    if (b.previewMs < TRACK_LIMITS.minPreviewMs || b.previewMs > TRACK_LIMITS.maxPreviewMs) throw new BadRequestException('O trecho tem de ter entre 10 e 60 segundos');
    const audio = (
      await this.pool.query(
        `SELECT a.mime FROM content.media_assets a WHERE a.id = $1 AND a.owner_id = $2 AND a.purpose = 'music' AND a.status = 'ready'
            AND NOT EXISTS (SELECT 1 FROM content.artist_tracks t WHERE t.audio_media_id = a.id)`,
        [b.audioMediaId, userId],
      )
    ).rows[0];
    if (!audio) throw new BadRequestException('Áudio inválido ou ainda não carregado');
    if (b.coverMediaId) {
      const ok = await this.pool.query(`SELECT 1 FROM content.media_assets WHERE id = $1 AND owner_id = $2 AND purpose = 'public' AND status = 'ready' AND mime LIKE 'image/%'`, [b.coverMediaId, userId]);
      if (!ok.rowCount) throw new BadRequestException('A capa tem de ser uma foto tua já carregada');
    }
    const { previewId, durationMs } = await this.cutPreview(userId, b.audioMediaId, audio.mime as string, b.previewStartMs, b.previewMs);
    const id = uuidv7();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO content.artist_tracks (id, artist_id, title, styles, explicit, audio_media_id, preview_media_id, cover_media_id, duration_ms, preview_start_ms, preview_ms, license_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [id, userId, b.title.trim(), styles, b.explicit, b.audioMediaId, previewId, b.coverMediaId ?? null, durationMs, b.previewStartMs, b.previewMs, MUSIC_LICENSE_VERSION],
      );
      await client.query('INSERT INTO content.artist_track_licenses (id, track_id, user_id, version, text_sha256) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), id, userId, MUSIC_LICENSE_VERSION, MUSIC_LICENSE_SHA256]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      await this.dropMedia([previewId]);
      throw e;
    } finally {
      client.release();
    }
    return (await this.myTracks(userId)).find((t) => t.id === id)!;
  }

  /** Confirma a duração (ffprobe) e corta o trecho em AAC (M4A), com uma entrada e uma saída suaves. */
  private async cutPreview(ownerId: string, audioId: string, mime: string, startMs: number, lenMs: number): Promise<{ previewId: string; durationMs: number }> {
    const dir = await mkdtemp(join(tmpdir(), 'txill-mus-'));
    const src = join(dir, `src.${mime === 'audio/mpeg' ? 'mp3' : mime === 'audio/aac' ? 'aac' : 'm4a'}`);
    const out = join(dir, 'preview.m4a');
    try {
      await writeFile(src, await this.media.rawBytes(audioId, 'private'));
      let seconds = 0;
      try {
        const { stdout } = await run(ffprobe.path, ['-v', 'error', ...SAFE_AUDIO, '-print_format', 'json', '-show_format', '-show_streams', src], { timeout: 30_000 });
        const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type: string; duration?: string }[] };
        const a = info.streams?.find((s) => s.codec_type === 'audio');
        seconds = a ? Number(info.format?.duration ?? a.duration ?? 0) : 0;
      } catch {
        seconds = 0;
      }
      if (!Number.isFinite(seconds) || seconds <= 0) throw new BadRequestException('Este ficheiro não parece ser uma música válida (MP3, M4A ou AAC)');
      const durationMs = Math.round(seconds * 1000);
      if (durationMs < TRACK_LIMITS.minTrackMs) throw new BadRequestException('A música tem de ter pelo menos 15 segundos');
      if (durationMs > TRACK_LIMITS.maxTrackMs) throw new BadRequestException('A música pode ter até 15 minutos');
      if (startMs < 0 || startMs + lenMs > durationMs + 500) throw new BadRequestException('O trecho passa do fim da música. Escolhe um início mais cedo');
      const len = Math.min(lenMs, durationMs - startMs) / 1000;
      await run(
        FFMPEG,
        ['-y', ...SAFE_AUDIO, '-ss', (startMs / 1000).toFixed(3), '-t', len.toFixed(3), '-i', src, '-vn', '-map_metadata', '-1',
          '-af', `afade=t=in:d=0.3,afade=t=out:st=${Math.max(0, len - 1).toFixed(3)}:d=1`, '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', out],
        { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      ).catch((e) => {
        this.log.warn(`falha a cortar o trecho de ${audioId}: ${(e as Error).message}`);
        throw new BadRequestException('Não consegui preparar o trecho desta música. Tenta outro ficheiro (MP3 ou M4A)');
      });
      const previewId = await this.media.storeDerived(ownerId, await readFile(out), 'audio/mp4', 'music', Math.round(len * 1000));
      return { previewId, durationMs };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** As minhas faixas, com o estado e os números (quantas vezes foram usadas e por quantas pessoas). */
  async myTracks(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT t.*, (SELECT count(*) FROM content.artist_track_uses u WHERE u.track_id = t.id)::int AS uses,
              (SELECT count(DISTINCT u.user_id) FROM content.artist_track_uses u WHERE u.track_id = t.id)::int AS people,
              (SELECT l.accepted_at FROM content.artist_track_licenses l WHERE l.track_id = t.id ORDER BY l.accepted_at DESC LIMIT 1) AS license_accepted_at
         FROM content.artist_tracks t WHERE t.artist_id = $1 ORDER BY t.created_at DESC LIMIT 200`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      styles: r.styles as string[],
      explicit: r.explicit as boolean,
      status: r.status as string,
      /** Escondida por uma denúncia de direitos de autor, enquanto a equipa analisa. */
      onHold: !!r.hold_at,
      reason: (r.review_reason as string | null) ?? null,
      durationMs: r.duration_ms as number,
      previewStartMs: r.preview_start_ms as number,
      previewMs: r.preview_ms as number,
      previewUrl: r.preview_media_id && r.status !== 'removed' ? this.media.musicUrl(r.preview_media_id as string, true) : null,
      cover: r.cover_media_id ? `/api/v1/media/${r.cover_media_id as string}?w=480` : null,
      licenseVersion: r.license_version as string,
      licenseAcceptedAt: (r.license_accepted_at as string | null) ?? null,
      uses: r.uses as number,
      people: r.people as number,
      createdAt: r.created_at as string,
      approvedAt: (r.approved_at as string | null) ?? null,
      withdrawnAt: (r.withdrawn_at as string | null) ?? null,
    }));
  }

  /** Retirar uma faixa: deixa de estar disponível para novos usos; os mimos e as tchekas que já a usam continuam a tocá-la. */
  async withdrawTrack(userId: string, trackId: string) {
    const r = await this.pool.query(
      `UPDATE content.artist_tracks SET status = 'withdrawn', withdrawn_at = now() WHERE id = $1 AND artist_id = $2 AND status IN ('pending', 'approved') RETURNING id`,
      [trackId, userId],
    );
    if (!r.rowCount) throw new NotFoundException('Faixa não encontrada ou já retirada');
    return { status: 'withdrawn' as const };
  }

  /* ───────────── o seletor e os usos ───────────── */

  private toLocal(r: Record<string, unknown>): LocalTrack {
    const url = this.media.musicUrl(r.preview_media_id as string);
    return {
      source: 'local',
      id: localId(r.id as string),
      trackId: r.id as string,
      title: r.title as string,
      artist: r.stage_name as string,
      artistUsername: (r.username as string | null) ?? null,
      duration: Math.round((r.preview_ms as number) / 1000),
      durationMs: r.preview_ms as number,
      previewUrl: url,
      url,
      cover: r.cover_media_id ? `/api/v1/media/${r.cover_media_id as string}?w=480` : null,
      license: 'txillapp',
      licenseUrl: null,
      landing: null,
      styles: (r.styles as string[]) ?? [],
      explicit: !!r.explicit,
    };
  }

  /**
   * «Artistas de Moçambique» no seletor: as faixas aprovadas e disponíveis, as mais usadas nos últimos 30 dias primeiro e depois
   * as mais recentes. Filtra por texto (título ou artista), estilo ou @ do artista. Menores não veem as explícitas.
   */
  async catalog(viewerId: string, opts: { q?: string; style?: string; artist?: string; limit?: number } = {}): Promise<LocalTrack[]> {
    const params: unknown[] = [viewerId];
    const where = [AVAILABLE('t')];
    where.push(`(NOT t.explicit OR NOT (${MINOR}))`);
    const q = opts.q?.trim().slice(0, 60);
    if (q && q.length >= 2) {
      params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`(t.title ILIKE $${params.length} OR ap.stage_name ILIKE $${params.length})`);
    }
    if (opts.style) {
      params.push(opts.style.toLowerCase().slice(0, 30));
      where.push(`$${params.length} = ANY(t.styles)`);
    }
    if (opts.artist) {
      params.push(opts.artist.slice(0, 40));
      where.push(`u.username = $${params.length}`);
    }
    params.push(Math.min(Math.max(opts.limit ?? 30, 1), 50));
    const { rows } = await this.pool.query(
      `SELECT t.id, t.title, t.styles, t.explicit, t.preview_media_id, t.cover_media_id, t.preview_ms, ap.stage_name, u.username,
              (SELECT count(*) FROM content.artist_track_uses x WHERE x.track_id = t.id AND x.created_at > now() - interval '30 days') AS recent
         FROM content.artist_tracks t
         JOIN content.artist_profiles ap ON ap.user_id = t.artist_id
         JOIN identity.users u ON u.id = t.artist_id
        WHERE ${where.join(' AND ')}
        ORDER BY recent DESC, t.approved_at DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map((r) => this.toLocal(r));
  }

  /**
   * Antes de guardar um mimo ou uma tcheka com uma faixa local: tem de estar disponível (e não explícita para menores).
   * Devolve o que fica guardado na publicação e conta o uso (o artista vê os totais).
   */
  async prepareUse(userId: string, id: string, surface: 'post' | 'story'): Promise<Record<string, unknown>> {
    const trackId = parseLocalId(id);
    const r = (
      await this.pool.query(
        `SELECT t.id, t.title, t.styles, t.explicit, t.preview_media_id, t.cover_media_id, t.preview_ms, ap.stage_name, u.username, (${MINOR}) AS minor
           FROM content.artist_tracks t JOIN content.artist_profiles ap ON ap.user_id = t.artist_id JOIN identity.users u ON u.id = t.artist_id
          WHERE t.id = $2 AND ${AVAILABLE('t')}`,
        [userId, trackId],
      )
    ).rows[0];
    if (!r) throw new BadRequestException('Esta música já não está disponível');
    if (r.explicit && r.minor) throw new ForbiddenException('Esta música é explícita');
    await this.pool.query('INSERT INTO content.artist_track_uses (track_id, user_id, surface) VALUES ($1, $2, $3)', [trackId, userId, surface]);
    const snap: Snapshot = {
      source: 'local',
      id: localId(trackId),
      trackId,
      title: r.title as string,
      artist: r.stage_name as string,
      artistUsername: r.username as string,
      previewMediaId: r.preview_media_id as string,
      coverMediaId: (r.cover_media_id as string | null) ?? null,
      durationMs: r.preview_ms as number,
      styles: r.styles as string[],
      explicit: !!r.explicit,
      license: 'txillapp',
    };
    return snap as unknown as Record<string, unknown>;
  }

  /** Ao devolver uma publicação: o trecho ganha um URL assinado (quem pode ouvir decide-se ao servir o ficheiro). */
  resolveSnapshot(m: Record<string, unknown>): LocalTrack {
    const s = m as unknown as Snapshot;
    const url = this.media.musicUrl(s.previewMediaId);
    return {
      source: 'local',
      id: s.id,
      trackId: s.trackId,
      title: s.title,
      artist: s.artist,
      artistUsername: s.artistUsername ?? null,
      duration: Math.round((s.durationMs ?? 0) / 1000),
      durationMs: s.durationMs,
      previewUrl: url,
      url,
      cover: s.coverMediaId ? `/api/v1/media/${s.coverMediaId}?w=480` : null,
      license: 'txillapp',
      licenseUrl: null,
      landing: null,
      styles: s.styles ?? [],
      explicit: !!s.explicit,
    };
  }

  /**
   * Servir o trecho. Com o URL normal: só se a faixa não estiver escondida por denúncia nem tirada pela equipa e a conta do
   * artista existir (uma faixa retirada pelo artista continua a tocar nos usos antigos). Com o URL da equipa (`review`): sempre,
   * enquanto o ficheiro existir (para moderar).
   */
  async audio(mediaId: string, exp: number, sig: string, review: boolean): Promise<Served> {
    const found = await this.media.locateMusic(mediaId, exp, sig, review);
    if (!review) {
      const ok = await this.pool.query(
        `SELECT 1 FROM content.artist_tracks t JOIN identity.users u ON u.id = t.artist_id
          WHERE t.preview_media_id = $1 AND t.status IN ('approved', 'withdrawn') AND t.hold_at IS NULL AND u.status = 'active'`,
        [mediaId],
      );
      if (!ok.rowCount) throw new NotFoundException();
    }
    return found;
  }

  /** O artista de um perfil: a etiqueta «Artista», o nome artístico, os estilos e as ligações (só depois de aprovado). */
  async publicArtist(username: string) {
    const r = (
      await this.pool.query(
        `SELECT ap.stage_name, ap.styles, ap.links FROM content.artist_profiles ap JOIN identity.users u ON u.id = ap.user_id
          WHERE u.username = $1 AND u.status = 'active' AND ap.status = 'approved'`,
        [username],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Esta conta não é de artista');
    return { stageName: r.stage_name as string, styles: r.styles as string[], links: r.links as { kind: string; url: string }[] };
  }

  /* ───────────── denúncias de direitos de autor ───────────── */

  /** Qualquer pessoa pode denunciar uma faixa. A faixa fica escondida logo (sem novos usos e sem tocar) até a equipa decidir. */
  async reportTrack(userId: string, id: string, b: ClaimInput) {
    const trackId = parseLocalId(id);
    const t = (await this.pool.query(`SELECT artist_id, status FROM content.artist_tracks WHERE id = $1`, [trackId])).rows[0];
    if (!t || t.status === 'removed' || t.status === 'rejected') throw new NotFoundException('Faixa não encontrada');
    if (t.artist_id === userId) throw new BadRequestException('Não podes denunciar uma faixa tua. Para a tirar, retira-a no Gerir');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO content.artist_track_claims (id, track_id, reporter_id, claimant_name, contact_email, relation, details) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING RETURNING id`,
        [uuidv7(), trackId, userId, b.claimantName.trim(), b.contactEmail.trim().toLowerCase(), b.relation, b.details.trim()],
      );
      if (!ins.rowCount) throw new ConflictException('Já denunciaste esta faixa. A equipa está a analisar');
      // O artista vê «Escondida por denúncia» no Gerir (sem aviso: o aviso viria em nome de quem denunciou).
      await client.query(`UPDATE content.artist_tracks SET hold_at = now() WHERE id = $1 AND hold_at IS NULL`, [trackId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    return { reported: true as const };
  }

  /* ───────────── a equipa (backoffice) ───────────── */

  private async audit(c: Pool | PoolClient, actor: string, action: string, target: string, metadata: Record<string, unknown>) {
    await c.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), actor, action, target, metadata]);
  }

  /** Aviso à pessoa, em nome do Txillapp (nunca da pessoa da equipa). */
  private async tell(userId: string, actorId: string, data: { what: 'artist' | 'track'; decision: string; title?: string; reason?: string }) {
    if (userId === actorId) return;
    await this.notifications.notify({ userId, actorId, kind: 'music_review', data });
  }

  /** Fila de pedidos de artista (com a prova por URL privado e temporário). */
  async queueArtists(status: 'pending' | 'approved' | 'rejected' | 'revoked' = 'pending') {
    const { rows } = await this.pool.query(
      `SELECT ap.*, u.username, u.display_name, u.status AS user_status, (SELECT count(*) FROM social.follows f WHERE f.followee_id = u.id)::int AS followers,
              (SELECT count(*) FROM content.artist_tracks t WHERE t.artist_id = u.id)::int AS tracks
         FROM content.artist_profiles ap JOIN identity.users u ON u.id = ap.user_id
        WHERE ap.status = $1 AND u.status = 'active' ORDER BY ap.updated_at ASC LIMIT 200`,
      [status],
    );
    return rows.map((r) => ({
      userId: r.user_id as string,
      user: { username: r.username as string, displayName: r.display_name as string, followers: r.followers as number },
      tracks: r.tracks as number,
      ...this.artistRow(r),
      proofUrl: r.proof_media_id ? this.media.chatUrl(r.proof_media_id as string) : null,
      updatedAt: r.updated_at as string,
    }));
  }

  /** Aprovar, recusar (com motivo) ou tirar o estatuto de artista (com motivo; as faixas deixam de estar disponíveis). */
  async decideArtist(actor: string, userId: string, action: 'approve' | 'reject' | 'revoke', reason?: string) {
    if (action !== 'approve' && !reason?.trim()) throw new BadRequestException('Diz o motivo');
    const from = action === 'revoke' ? ['approved'] : ['pending'];
    const to = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'revoked';
    const why = action === 'approve' ? null : reason!.trim().slice(0, 300);
    const client = await this.pool.connect();
    let row: { stage_name: string; proof_media_id: string | null } | undefined;
    try {
      await client.query('BEGIN');
      row = (
        await client.query(
          `UPDATE content.artist_profiles SET status = $2, review_reason = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now(),
                  approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE approved_at END
            WHERE user_id = $1 AND status = ANY($5) RETURNING stage_name, proof_media_id`,
          [userId, to, why, actor, from],
        )
      ).rows[0];
      if (!row) throw new NotFoundException('Pedido não encontrado ou já decidido');
      await this.audit(client, actor, `artist.${action}`, `user:${userId}`, { stageName: row.stage_name, ...(why ? { reason: why } : {}) });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    // A prova só serve para decidir: apaga-se depois.
    await this.dropMedia([row.proof_media_id]);
    await this.pool.query('UPDATE content.artist_profiles SET proof_media_id = NULL WHERE user_id = $1', [userId]);
    await this.tell(userId, actor, { what: 'artist', decision: to, ...(why ? { reason: why } : {}) });
  }

  /** Fila das faixas (para ouvir o trecho e o original com URL da equipa). `held`: as escondidas por denúncia. */
  async queueTracks(status: 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'removed' | 'held' = 'pending') {
    const { rows } = await this.pool.query(
      `SELECT t.*, ap.stage_name, ap.rights_kind, ap.label_name, u.username,
              (SELECT count(*) FROM content.artist_track_uses x WHERE x.track_id = t.id)::int AS uses,
              (SELECT count(DISTINCT x.user_id) FROM content.artist_track_uses x WHERE x.track_id = t.id)::int AS people,
              (SELECT count(*) FROM content.artist_track_claims c WHERE c.track_id = t.id AND c.status = 'open')::int AS open_claims,
              (SELECT json_build_object('version', l.version, 'sha256', l.text_sha256, 'acceptedAt', l.accepted_at) FROM content.artist_track_licenses l WHERE l.track_id = t.id ORDER BY l.accepted_at DESC LIMIT 1) AS license
         FROM content.artist_tracks t JOIN content.artist_profiles ap ON ap.user_id = t.artist_id JOIN identity.users u ON u.id = t.artist_id
        WHERE ${status === 'held' ? 't.hold_at IS NOT NULL' : 't.status = $1'} ORDER BY t.created_at ASC LIMIT 200`,
      status === 'held' ? [] : [status],
    );
    return rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      artist: { userId: r.artist_id as string, username: r.username as string, stageName: r.stage_name as string, rightsKind: r.rights_kind as string, labelName: (r.label_name as string | null) ?? null },
      styles: r.styles as string[],
      explicit: r.explicit as boolean,
      status: r.status as string,
      onHold: !!r.hold_at,
      openClaims: r.open_claims as number,
      reason: (r.review_reason as string | null) ?? null,
      durationMs: r.duration_ms as number,
      previewStartMs: r.preview_start_ms as number,
      previewMs: r.preview_ms as number,
      previewUrl: r.preview_media_id ? this.media.musicUrl(r.preview_media_id as string, true) : null,
      originalUrl: r.audio_media_id ? this.media.musicUrl(r.audio_media_id as string, true) : null,
      cover: r.cover_media_id ? `/api/v1/media/${r.cover_media_id as string}?w=480` : null,
      license: (r.license as { version: string; sha256: string; acceptedAt: string } | null) ?? null,
      uses: r.uses as number,
      people: r.people as number,
      createdAt: r.created_at as string,
    }));
  }

  /**
   * Moderar uma faixa: aprovar (aparece no seletor), recusar (com motivo), tirar (com motivo: deixa de tocar em todo o lado)
   * ou repor uma faixa tirada (volta a aprovada).
   */
  async decideTrack(actor: string, trackId: string, action: 'approve' | 'reject' | 'remove' | 'restore', reason?: string) {
    if ((action === 'reject' || action === 'remove') && !reason?.trim()) throw new BadRequestException('Diz o motivo');
    const why = reason?.trim() ? reason.trim().slice(0, 300) : null;
    const sql = {
      approve: `UPDATE content.artist_tracks SET status = 'approved', approved_at = now(), review_reason = NULL, reviewed_by = $2, reviewed_at = now() WHERE id = $1 AND status = 'pending' RETURNING artist_id, title`,
      reject: `UPDATE content.artist_tracks SET status = 'rejected', review_reason = $3, reviewed_by = $2, reviewed_at = now() WHERE id = $1 AND status = 'pending' RETURNING artist_id, title`,
      remove: `UPDATE content.artist_tracks SET status = 'removed', removed_at = now(), review_reason = $3, reviewed_by = $2, reviewed_at = now() WHERE id = $1 AND status IN ('pending', 'approved', 'withdrawn') RETURNING artist_id, title`,
      restore: `UPDATE content.artist_tracks SET status = 'approved', removed_at = NULL, hold_at = NULL, review_reason = NULL, reviewed_by = $2, reviewed_at = now(), approved_at = coalesce(approved_at, now()) WHERE id = $1 AND status = 'removed' RETURNING artist_id, title`,
    }[action];
    const client = await this.pool.connect();
    let row: { artist_id: string; title: string } | undefined;
    try {
      await client.query('BEGIN');
      row = (await client.query(sql, action === 'reject' || action === 'remove' ? [trackId, actor, why] : [trackId, actor])).rows[0];
      if (!row) throw new NotFoundException('Faixa não encontrada ou já decidida');
      await this.audit(client, actor, `artist_track.${action}`, `user:${row.artist_id}`, { track: trackId, title: row.title, ...(why ? { reason: why } : {}) });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    const decision = { approve: 'approved', reject: 'rejected', remove: 'removed', restore: 'restored' }[action];
    await this.tell(row.artist_id, actor, { what: 'track', decision, title: row.title, ...(why ? { reason: why } : {}) });
  }

  /** Denúncias de direitos de autor. */
  async queueClaims(status: 'open' | 'upheld' | 'dismissed' = 'open') {
    const { rows } = await this.pool.query(
      `SELECT c.*, t.title, t.status AS track_status, t.preview_media_id, ap.stage_name, au.username AS artist_username, ru.username AS reporter_username
         FROM content.artist_track_claims c JOIN content.artist_tracks t ON t.id = c.track_id
         JOIN content.artist_profiles ap ON ap.user_id = t.artist_id JOIN identity.users au ON au.id = t.artist_id
         LEFT JOIN identity.users ru ON ru.id = c.reporter_id
        WHERE c.status = $1 ORDER BY c.created_at ASC LIMIT 200`,
      [status],
    );
    return rows.map((r) => ({
      id: r.id as string,
      track: { id: r.track_id as string, title: r.title as string, status: r.track_status as string, artist: r.stage_name as string, artistUsername: r.artist_username as string, previewUrl: r.preview_media_id ? this.media.musicUrl(r.preview_media_id as string, true) : null },
      reporter: (r.reporter_username as string | null) ?? null,
      claimantName: r.claimant_name as string,
      contactEmail: r.contact_email as string,
      relation: r.relation as string,
      details: r.details as string,
      status: r.status as string,
      decisionNote: (r.decision_note as string | null) ?? null,
      createdAt: r.created_at as string,
    }));
  }

  /**
   * Decidir uma denúncia: dar razão ('uphold': a faixa sai de vez, também dos usos antigos) ou não ('dismiss': se não houver
   * outras denúncias abertas, a faixa volta a aparecer). Sempre com motivo, que fica no registo.
   */
  async decideClaim(actor: string, claimId: string, action: 'uphold' | 'dismiss', reason: string) {
    if (!reason?.trim()) throw new BadRequestException('Diz o motivo');
    const why = reason.trim().slice(0, 300);
    const client = await this.pool.connect();
    let out: { track_id: string; artist_id: string; title: string; released: boolean } | undefined;
    try {
      await client.query('BEGIN');
      const c = (
        await client.query(
          `UPDATE content.artist_track_claims SET status = $2, decision_note = $3, decided_by = $4, decided_at = now() WHERE id = $1 AND status = 'open' RETURNING track_id`,
          [claimId, action === 'uphold' ? 'upheld' : 'dismissed', why, actor],
        )
      ).rows[0];
      if (!c) throw new NotFoundException('Denúncia não encontrada ou já decidida');
      let released = false;
      if (action === 'uphold') {
        await client.query(`UPDATE content.artist_tracks SET status = 'removed', removed_at = now(), review_reason = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1 AND status <> 'removed'`, [c.track_id, why, actor]);
        // As outras denúncias da mesma faixa ficam resolvidas também.
        await client.query(`UPDATE content.artist_track_claims SET status = 'upheld', decision_note = $2, decided_by = $3, decided_at = now() WHERE track_id = $1 AND status = 'open'`, [c.track_id, why, actor]);
      } else {
        const left = await client.query(`SELECT 1 FROM content.artist_track_claims WHERE track_id = $1 AND status = 'open'`, [c.track_id]);
        if (!left.rowCount) released = !!(await client.query(`UPDATE content.artist_tracks SET hold_at = NULL WHERE id = $1 AND hold_at IS NOT NULL RETURNING id`, [c.track_id])).rowCount;
      }
      const t = (await client.query('SELECT artist_id, title FROM content.artist_tracks WHERE id = $1', [c.track_id])).rows[0];
      await this.audit(client, actor, `artist_claim.${action}`, `user:${t.artist_id as string}`, { claim: claimId, track: c.track_id, title: t.title, reason: why });
      await client.query('COMMIT');
      out = { track_id: c.track_id as string, artist_id: t.artist_id as string, title: t.title as string, released };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    if (action === 'uphold') await this.tell(out.artist_id, actor, { what: 'track', decision: 'removed', title: out.title, reason: why });
    else if (out.released) await this.tell(out.artist_id, actor, { what: 'track', decision: 'restored', title: out.title });
  }

  /** Para o resumo do backoffice: o que está à espera. */
  async pending() {
    const r = (
      await this.pool.query(
        `SELECT (SELECT count(*) FROM content.artist_profiles WHERE status = 'pending')::int AS artists,
                (SELECT count(*) FROM content.artist_tracks WHERE status = 'pending')::int AS tracks,
                (SELECT count(*) FROM content.artist_track_claims WHERE status = 'open')::int AS claims`,
      )
    ).rows[0];
    return { artists: r.artists as number, tracks: r.tracks as number, claims: r.claims as number };
  }
}

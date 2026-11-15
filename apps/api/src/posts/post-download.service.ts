import { createHash } from 'crypto';
import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Readable } from 'stream';
import { Pool } from 'pg';
import { tierOf } from '../common/badge';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { END_CARD_S } from '../media/end-card';
import { renderSignedCopy } from '../media/end-card-video';
import { MediaService } from '../media/media.service';
import type { SealTier } from '../media/signature';
import { canView } from '../social/visibility';
import { POST_SOUND_REMOVED_SQL } from '../sounds/sounds.service';
import { BAKE_PLAYABLE } from './music-bake';
import { MusicBakeService } from './music-bake.service';
import { TchekaStorage } from './tcheka-storage';

/** Muda quando o desenho da cópia muda (o cartão, a assinatura, a mistura): as cópias antigas deixam de servir. */
export const DOWNLOAD_RENDER_VERSION = 'fim-1';
/** Quanto tempo uma cópia fica guardada (depois faz-se outra, se alguém a pedir). */
const KEEP_DAYS = 30;
/** Cópias a fazer ao mesmo tempo em cada processo (o resto espera a vez). */
const AT_ONCE = 2;
const QUEUE_MAX = 12;
const RENDER_TIMEOUT_MS = 4 * 60_000;

export interface Served {
  filename: string;
  cache: 'hit' | 'miss';
  /** No disco: um stream e o tamanho; no S3: os bytes. */
  body: { stream: Readable; size: number } | { bytes: Buffer };
}

/** A versão da cópia: o vídeo de onde parte (e o tamanho dele: um som tirado troca os bytes), o @, o selo, o som e o desenho. */
export function downloadVersion(p: { sourceId: string; sourceSize: number; label: string; handle: boolean; seal: SealTier | null; signed: boolean; mute: boolean }): string {
  const key = [DOWNLOAD_RENDER_VERSION, p.sourceId, p.sourceSize, p.label, p.handle ? '@' : '-', p.seal ?? '-', p.signed ? 's' : '-', p.mute ? 'm' : '-'].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

/**
 * Os outros podem guardar as tchekas desta conta? A definição «Deixar guardar as minhas tchekas» (0153), uma conta pública e
 * de um adulto (18+; sem data de nascimento conta como menor). Em SQL, com `u` = o autor; dá NULL sem data de nascimento
 * (use-se com `IS TRUE`). O próprio autor pode sempre guardar as suas (isso fica de fora daqui).
 */
export const DOWNLOADS_ALLOWED = (u = 'u') =>
  `(${u}.allow_downloads AND NOT ${u}.is_private AND ${u}.birth_date <= (current_date - interval '18 years'))`;

/** O `canDownload` de cada publicação (FEED_SQL, com $1 = quem vê e `p`/`u` = a publicação e o autor). */
export const CAN_DOWNLOAD_SQL = (p = 'p', u = 'u') => `((${p}.author_id = $1 OR ${DOWNLOADS_ALLOWED(u)}) IS TRUE)`;

/** A resposta (403) quando quem publicou não deixa guardar (a definição, uma conta privada ou de um menor: não se diz qual). */
export const DOWNLOAD_BLOCKED = 'Quem publicou não deixa guardar as suas tchekas.';

/**
 * Guardar ou partilhar uma tcheka (`GET /posts/:id/download`), como o fim das do TikTok: o vídeo com a assinatura do canto
 * (o logótipo e o @, se o vídeo ainda não a tiver) e, no fim, o cartão do Txillapp (media/end-card.ts) com o logótipo
 * animado e o @ de quem publicou. Com a música gravada (posts/music-bake.ts): se ainda estiver na fila, faz-se antes.
 *
 * Quem pode: o autor, sempre; os outros, se podem ver a publicação (as regras de sempre: conta ativa, sem bloqueio, pública
 * ou seguida) e o autor deixa (DOWNLOADS_ALLOWED: «Deixar guardar as minhas tchekas», ligado por omissão; nunca numa conta
 * privada ou de um menor). Senão 403 (DOWNLOAD_BLOCKED). Num post de um sítio conta a conta de quem o publicou. Só
 * publicações com um vídeo (as tchekas e o primeiro vídeo de um carrossel); um repost guarda o original, com a regra do autor
 * do original. A definição vê-se e muda-se em `GET/PUT /posts/me/download-settings` (settings/setSettings).
 *
 * A cópia faz-se uma vez por versão (downloadVersion) e fica em content.post_downloads (ficheiro privado que expira em
 * KEEP_DAYS); as vezes seguintes saem logo.
 */
@Injectable()
export class PostDownloadService {
  private readonly log = new Logger('PostDownload');
  private readonly files: TchekaStorage;
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly making = new Map<string, Promise<string>>();

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) config: AppConfig,
    private readonly media: MediaService,
    private readonly bakes: MusicBakeService,
  ) {
    this.files = new TchekaStorage(config);
  }

  async download(viewerId: string, postId: string): Promise<Served> {
    let post = await this.target(viewerId, postId);
    // A música ainda por gravar: faz-se agora (a cópia leva-a), ou espera-se um pouco por quem já a está a fazer. Se não
    // ficar feita, a cópia sai do vídeo original (sem a música, como se ouvia sem a app).
    if (post.bake_status && ['queued', 'working', 'failed'].includes(post.bake_status)) {
      await this.bakes.ensureReady(post.id, 60_000);
      post = await this.target(viewerId, postId);
    }
    const venue = !!post.venue_name;
    const seal: SealTier | null = venue ? (post.venue_verified ? 'verified' : null) : tierOf(post.verified, post.verified_tier);
    const label = venue ? String(post.venue_name) : String(post.username);
    const sourceId = String(post.bake_media ?? post.media_id);
    const sourceSize = Number(post.bake_media ? post.bake_size : post.media_size) || 0;
    const mute = !!post.sound_removed;
    const signed = !!post.signed;
    const version = downloadVersion({ sourceId, sourceSize, label, handle: !venue, seal, signed, mute });
    const filename = `txillapp-tcheka-${String(post.short_code ?? post.id).slice(0, 12)}.mp4`;

    const hit = await this.cached(post.id, version);
    if (hit) return { filename, cache: 'hit', body: await this.files.open(hit, 'private') };

    const key = `${post.id}:${version}`;
    let job = this.making.get(key);
    if (!job) {
      job = this.make(post, sourceId, version, { label, handle: !venue, seal, signed, mute, cornerUser: venue ? null : label }).finally(() => this.making.delete(key));
      this.making.set(key, job);
    }
    const mediaId = await job;
    return { filename, cache: 'miss', body: await this.files.open(mediaId, 'private') };
  }

  /** A publicação, se quem pede a pode ver e tem um vídeo pronto (num repost simples, o original). */
  private async target(viewerId: string, postId: string): Promise<Record<string, any>> {
    const q = async (id: string) =>
      (
        await this.pool.query(
          `SELECT p.id, p.short_code, p.kind, p.repost_of, p.author_id, u.username, u.verified, u.verified_tier,
                  v.name AS venue_name, v.verified AS venue_verified,
                  (SELECT pm.media_id FROM content.post_media pm JOIN content.media_assets ma ON ma.id = pm.media_id
                    WHERE pm.post_id = p.id AND ma.mime LIKE 'video/%' AND ma.status = 'ready' AND ma.purpose = 'public' ORDER BY pm.position LIMIT 1) AS media_id,
                  pmb.status AS bake_status, CASE WHEN ${BAKE_PLAYABLE('p')} THEN pmb.media_id END AS bake_media, pmb.source_media_id AS bake_source,
                  ${POST_SOUND_REMOVED_SQL('p')} AS sound_removed, ${CAN_DOWNLOAD_SQL('p', 'u')} AS can_download
             FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL
             LEFT JOIN content.venues v ON v.id = p.venue_id
             LEFT JOIN content.post_music_bakes pmb ON pmb.post_id = p.id
            WHERE p.id = $2 AND ${canView()}`,
          [viewerId, id],
        )
      ).rows[0] as Record<string, any> | undefined;
    let r = await q(postId);
    if (r?.kind === 'repost' && r.repost_of && !r.media_id) r = await q(r.repost_of as string);
    if (!r) throw new NotFoundException('Publicação não encontrada');
    if (!r.media_id) throw new UnprocessableEntityException('Esta publicação não tem vídeo para guardar');
    // Quem publicou (o do original, num repost) desligou, ou a conta é privada ou de um menor: só ele guarda.
    if (r.can_download !== true) throw new ForbiddenException(DOWNLOAD_BLOCKED);
    // O vídeo com a música é o do primeiro vídeo da publicação.
    if (r.bake_media && r.bake_source !== r.media_id) r.bake_media = null;
    const ids = [r.media_id, r.bake_media].filter(Boolean);
    const meta = new Map((await this.pool.query(`SELECT id, size_bytes, signed FROM content.media_assets WHERE id = ANY($1::uuid[])`, [ids])).rows.map((m) => [m.id as string, m]));
    r.media_size = meta.get(r.media_id)?.size_bytes ?? 0;
    r.signed = meta.get(r.media_id)?.signed ?? false;
    r.bake_size = r.bake_media ? meta.get(r.bake_media)?.size_bytes ?? 0 : 0;
    return r;
  }

  /**
   * «Deixar guardar as minhas tchekas»: `allow` é o que a pessoa escolheu; `effective` é o que vale (conta privada ou de
   * menor: desligado), como em «Deixar usar o meu som» (SoundsService.settings).
   */
  async settings(userId: string) {
    const r = (
      await this.pool.query(
        `SELECT allow_downloads, is_private, (birth_date <= (current_date - interval '18 years')) AS adult FROM identity.users WHERE id = $1`,
        [userId],
      )
    ).rows[0];
    if (!r) throw new NotFoundException();
    return { allow: !!r.allow_downloads, effective: !!r.allow_downloads && !r.is_private && !!r.adult, private: !!r.is_private, minor: !r.adult };
  }

  async setSettings(userId: string, allow: boolean) {
    await this.pool.query('UPDATE identity.users SET allow_downloads = $2 WHERE id = $1', [userId, allow]);
    return this.settings(userId);
  }

  private async cached(postId: string, version: string): Promise<string | null> {
    const r = (
      await this.pool.query(
        `SELECT d.media_id FROM content.post_downloads d JOIN content.media_assets m ON m.id = d.media_id AND m.status = 'ready'
          WHERE d.post_id = $1 AND d.version = $2`,
        [postId, version],
      )
    ).rows[0];
    return (r?.media_id as string | undefined) ?? null;
  }

  private async slot(): Promise<() => void> {
    if (this.active >= AT_ONCE) {
      if (this.waiting.length >= QUEUE_MAX) throw new ServiceUnavailableException('Há muitas cópias a preparar agora. Tenta daqui a pouco.');
      await new Promise<void>((res) => this.waiting.push(res));
    }
    this.active += 1;
    return () => {
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }

  /** Faz a cópia, guarda-a (privada, expira em KEEP_DAYS) e troca a versão anterior desta publicação. */
  private async make(post: Record<string, any>, sourceId: string, version: string, o: { label: string; handle: boolean; seal: SealTier | null; signed: boolean; mute: boolean; cornerUser: string | null }): Promise<string> {
    const release = await this.slot();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), RENDER_TIMEOUT_MS);
    let tmp: string | null = null;
    const t0 = Date.now();
    try {
      tmp = await mkdtemp(join(tmpdir(), 'txdownload-'));
      const src = join(tmp, 'src.mp4'), out = join(tmp, 'out.mp4');
      await writeFile(src, await this.media.rawBytes(sourceId, 'public'));
      const r = await renderSignedCopy(src, out, tmp, { label: o.label, handle: o.handle, seal: o.seal, alreadySigned: o.signed, mute: o.mute, cornerUser: o.cornerUser, cornerSeal: o.seal }, ac.signal);
      const id = uuidv7();
      const size = await this.files.put(id, out, 'video/mp4', 'private');
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, purpose, status, duration_ms, width, height, signed, expires_at)
           VALUES ($1, $2, 'video/mp4', $3, $8, 'chat', 'ready', $4, $5, $6, true, now() + make_interval(days => $7))`,
          [id, post.author_id, size, Math.round(r.seconds * 1000), r.width, r.height, KEEP_DAYS, id],
        );
        // As versões anteriores desta publicação saem (o ficheiro apaga-se na limpeza de sempre, sweepDeleted).
        await client.query(
          `UPDATE content.media_assets SET status = 'deleted' WHERE id IN (SELECT media_id FROM content.post_downloads WHERE post_id = $1 AND version <> $2)`,
          [post.id, version],
        );
        await client.query(`DELETE FROM content.post_downloads WHERE post_id = $1 AND version <> $2`, [post.id, version]);
        await client.query(
          `INSERT INTO content.post_downloads (post_id, version, media_id) VALUES ($1, $2, $3)
           ON CONFLICT (post_id, version) DO UPDATE SET media_id = EXCLUDED.media_id, created_at = now()`,
          [post.id, version, id],
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
      this.log.log(`cópia da tcheka ${post.id as string}: ${r.seconds.toFixed(1)} s (${END_CARD_S} s de cartão) em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      return id;
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      this.log.error(`cópia da tcheka ${post.id as string} falhou: ${(e as Error).message}${(e as { stderr?: string }).stderr ? `\n${String((e as { stderr?: string }).stderr).slice(-1200)}` : ''}`);
      throw new ServiceUnavailableException('Não consegui preparar o vídeo. Tenta outra vez.');
    } finally {
      clearTimeout(timer);
      release();
      if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

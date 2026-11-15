import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { open, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Pool } from 'pg';
import { newInstanceId, runsBackground } from '../common/role';
import { uuidv7 } from '../common/uuid7';
import { ANALYZE_DECODE_HZ, ANALYZE_MAX_S, SILENCE_RMS } from '../compose/analyze';
import { decodeMono, ffmpeg, FfmpegError, probe, SAFE_VIDEO } from '../compose/ffmpeg';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { MediaService } from '../media/media.service';
import { MusicCatalogService } from '../music/catalog/catalog.service';
import { hostOk } from '../music/catalog/curation';
import { OPEN_LICENSES } from '../music/catalog/track';
import { RealtimeBus } from '../realtime/realtime-bus';
import { Scheduler } from '../realtime/scheduler';
import { MUSIC_SOUND_OK } from '../sounds/sounds.service';
import { bakeArgs, bakeMix } from './music-bake';
import { TchekaStorage } from './tcheka-storage';

/** O toque ao worker quando entra um trabalho. */
export const BAKE_KICK = 'music-bake.kick';
const POLL_MS = 5_000;
const HEARTBEAT_MS = 15_000;
const STALE_S = 120;
/** Tentativas antes de desistir (cada uma depois de 1 minuto). */
const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 3 * 60_000;
/** Como a montagem (compose.service): só https, só anfitriões permitidos, até 25 MB. */
const MAX_MUSIC_BYTES = 25 * 1024 * 1024;
const LOCAL_AUDIO = /^\/api\/v1\/music\/local\/audio\/([0-9a-f-]{36})(?:[?#]|$)/;
const LICENSES = new Set<string>(OPEN_LICENSES);

type AudioSrc = { from: 'url'; url: string } | { from: 'storage'; id: string; scope: 'public' | 'private' };
/** Não se grava (fica a música à parte, como antes): o motivo, para o registo. */
class Skip extends Error {}

/**
 * O worker que grava a música no vídeo das tchekas (o contrato em posts/music-bake.ts). A fila é a tabela
 * content.post_music_bakes, como a da montagem: cada processo que corre as filas (ROLE=worker, ou sem ROLE) apanha o mais
 * antigo com `FOR UPDATE SKIP LOCKED`, um de cada vez, com prioridade baixa (o ffmpeg da montagem) e um prazo. A cópia
 * guardada (PostDownloadService) pode pedir um trabalho já (`ensureReady`) para levar a música.
 */
@Injectable()
export class MusicBakeService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MusicBake');
  private readonly files: TchekaStorage;
  private readonly runsQueue: boolean;
  private readonly workerId = newInstanceId();
  private running = false;
  private again = false;
  private stopped = false;
  private offKick?: () => void;
  private readonly inFlight = new Map<string, Promise<void>>();
  /** Quem descarrega a música (os testes trocam-no por um que não sai da máquina). */
  fetcher: typeof fetch = (input, init) => fetch(input, init);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) config: AppConfig,
    private readonly media: MediaService,
    private readonly catalog: MusicCatalogService,
    private readonly scheduler: Scheduler,
    private readonly bus: RealtimeBus,
  ) {
    this.files = new TchekaStorage(config);
    this.runsQueue = runsBackground(config);
  }

  onModuleInit() {
    if (!this.runsQueue) return;
    this.offKick = this.bus.onSignal(BAKE_KICK, () => void this.pump());
    this.scheduler.every('music-bake.poll', POLL_MS, () => this.pump());
    this.scheduler.every('music-bake.stale', 60_000, () => this.requeueStale());
    void this.requeueStale(true).then(() => this.pump()).catch(() => undefined);
  }

  onModuleDestroy() {
    this.stopped = true;
    this.offKick?.();
  }

  /**
   * Depois de publicar uma tcheka com música (posts.service, create): se o vídeo já traz a música (uma montagem do servidor,
   * ou `musicInFile` do estúdio do site), fica 'inline'; senão entra na fila. `viaSound`: publicada com «Usar este som».
   */
  async afterPublish(postId: string, mediaId: string, o: { musicInFile: boolean; viaSound: boolean }): Promise<void> {
    const composed = (await this.pool.query(`SELECT 1 FROM content.compose_jobs WHERE media_id = $1 AND status = 'done'`, [mediaId])).rowCount;
    if (composed) {
      await this.pool.query(`INSERT INTO content.post_music_bakes (post_id, source_media_id, status, finished_at) VALUES ($1, $2, 'inline', now()) ON CONFLICT (post_id) DO NOTHING`, [postId, mediaId]);
      return;
    }
    // O estúdio do site diz que a música já vai no vídeo: confirma-se primeiro (`verify_inline`, ver work): no Safari do
    // iPhone o vídeo podia sair calado e a tcheka ficava muda.
    const mix = bakeMix(o.viaSound);
    await this.pool.query(
      `INSERT INTO content.post_music_bakes (post_id, source_media_id, original_volume, music_volume, music_start_ms, verify_inline) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (post_id) DO NOTHING`,
      [postId, mediaId, mix.originalVolume, mix.musicVolume, mix.musicStartMs, o.musicInFile],
    );
    this.kick();
  }

  private kick() {
    if (this.runsQueue) void this.pump();
    else this.bus.signal(BAKE_KICK);
  }

  /** Os trabalhos «a gravar» de um processo que caiu voltam para a fila. */
  private async requeueStale(includeMine = false) {
    await this.pool.query(
      `UPDATE content.post_music_bakes SET status = 'queued', worker_id = NULL
        WHERE status = 'working' AND (worker_id IS NULL OR heartbeat_at IS NULL OR heartbeat_at < now() - make_interval(secs => $2) OR ($3 AND worker_id = $1))`,
      [this.workerId, STALE_S, includeMine],
    );
  }

  /** Apanha o trabalho mais antigo (ou um falhado que ainda tem tentativas). `only`: só este. */
  private async claim(only?: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      `UPDATE content.post_music_bakes b SET status = 'working', started_at = now(), attempts = attempts + 1, worker_id = $1, heartbeat_at = now()
        WHERE b.post_id = (SELECT post_id FROM content.post_music_bakes
                            WHERE (status = 'queued' OR (status = 'failed' AND attempts < $2 AND finished_at < now() - interval '1 minute'))
                              AND ($3::uuid IS NULL OR post_id = $3)
                            ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING b.post_id`,
      [this.workerId, MAX_ATTEMPTS, only ?? null],
    );
    return (rows[0]?.post_id as string | undefined) ?? null;
  }

  /** Um de cada vez (o ffmpeg, mesmo só a misturar o som, não deve competir com a montagem). */
  async pump(): Promise<void> {
    if (!this.runsQueue || this.stopped) return;
    if (this.running) { this.again = true; return; }
    this.running = true;
    try {
      do {
        this.again = false;
        for (;;) {
          if (this.stopped) break;
          const id = await this.claim().catch((e) => { this.log.warn(`não consegui ler a fila: ${(e as Error).message}`); return null; });
          if (!id) break;
          await this.run(id);
        }
      } while (this.again && !this.stopped);
    } finally {
      this.running = false;
    }
  }

  /**
   * Para a cópia guardada: se esta publicação ainda tem o trabalho na fila, faz-se já (neste processo); se outro o está a
   * fazer, espera até `waitMs`. Devolve quando já não há nada a fazer (ou acabou o tempo).
   */
  async ensureReady(postId: string, waitMs = 60_000): Promise<void> {
    const until = Date.now() + waitMs;
    for (;;) {
      const r = (await this.pool.query(`SELECT status, attempts FROM content.post_music_bakes WHERE post_id = $1`, [postId])).rows[0];
      if (!r || !['queued', 'working', 'failed'].includes(r.status) || (r.status === 'failed' && r.attempts >= MAX_ATTEMPTS)) return;
      if (r.status !== 'working') {
        const mine = this.inFlight.get(postId);
        if (mine) { await mine; continue; }
        const id = await this.claim(postId);
        if (id) { await this.run(id); continue; }
        if (r.status === 'failed') return; // ainda no intervalo entre tentativas
      }
      if (Date.now() > until) return;
      await new Promise((res) => setTimeout(res, 400));
    }
  }

  private run(postId: string): Promise<void> {
    const p = this.work(postId).finally(() => this.inFlight.delete(postId));
    this.inFlight.set(postId, p);
    return p;
  }

  private async work(postId: string) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const beat = setInterval(() => void this.pool.query(`UPDATE content.post_music_bakes SET heartbeat_at = now() WHERE post_id = $1 AND worker_id = $2`, [postId, this.workerId]).catch(() => undefined), HEARTBEAT_MS);
    beat.unref();
    let tmp: string | null = null;
    const t0 = Date.now();
    try {
      const r = (
        await this.pool.query(
          `SELECT b.source_media_id, b.original_volume, b.music_volume, b.music_start_ms, b.verify_inline, p.music, p.author_id, p.removed_at, (${MUSIC_SOUND_OK('p')}) AS music_ok,
                  ma.status AS media_status, ma.signed, ma.width, ma.height, ma.duration_ms
             FROM content.post_music_bakes b JOIN content.posts p ON p.id = b.post_id JOIN content.media_assets ma ON ma.id = b.source_media_id
            WHERE b.post_id = $1`,
          [postId],
        )
      ).rows[0];
      if (!r || r.removed_at) throw new Skip('a publicação já não existe');
      if (!r.music) throw new Skip('sem música');
      if (r.media_status !== 'ready') throw new Skip('o vídeo já não está disponível');
      if (r.music_ok === false) throw new Skip('o som foi tirado');
      tmp = await mkdtemp(join(tmpdir(), 'txbake-'));
      const video = join(tmp, 'in.mp4'), music = join(tmp, 'music'), out = join(tmp, 'out.mp4');
      await writeFile(video, await this.media.rawBytes(r.source_media_id as string, 'public'));
      const info = await probe(video, SAFE_VIDEO);
      if (!info.hasVideo || !(info.seconds > 0)) throw new Skip('o vídeo não tem imagem');
      // Do estúdio do site, com a música já misturada: se o vídeo tem som, fica como está ('inline').
      if (r.verify_inline && (await this.audible(video, info, tmp, ac.signal))) {
        await this.pool.query(`UPDATE content.post_music_bakes SET status = 'inline', error = NULL, finished_at = now(), worker_id = NULL WHERE post_id = $1 AND status = 'working'`, [postId]);
        this.log.log(`tcheka ${postId}: a música já vinha no vídeo do estúdio do site`);
        return;
      }
      const src = await this.audioSource(r.music as Record<string, unknown>);
      await this.fetchAudio(src, music, ac.signal);
      await ffmpeg(bakeArgs({ video, music, seconds: info.seconds, hasAudio: info.hasAudio, originalVolume: Number(r.original_volume), musicVolume: Number(r.music_volume), musicStartMs: Number(r.music_start_ms), out }), { cwd: tmp, signal: ac.signal });
      const check = await probe(out);
      if (!check.hasAudio || !check.hasVideo) throw new Error('o vídeo gravado saiu sem som');
      const id = uuidv7();
      const size = await this.files.put(id, out, 'video/mp4', 'public');
      await this.files.copyPoster(r.source_media_id as string, id).catch(() => undefined);
      await this.pool.query(
        `INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, purpose, status, duration_ms, width, height, signed)
         VALUES ($1, $2, 'video/mp4', $3, $8, 'public', 'ready', $4, $5, $6, $7)`,
        [id, r.author_id, size, r.duration_ms ?? Math.round(info.seconds * 1000), r.width ?? (info.width || null), r.height ?? (info.height || null), !!r.signed, id],
      );
      const done = await this.pool.query(`UPDATE content.post_music_bakes SET status = 'done', media_id = $2, error = NULL, finished_at = now(), worker_id = NULL WHERE post_id = $1 AND status = 'working' RETURNING 1`, [postId, id]);
      // Entretanto apagada (a linha saiu com a publicação): o ficheiro novo não fica.
      if (!done.rowCount) await this.pool.query(`UPDATE content.media_assets SET status = 'deleted' WHERE id = $1`, [id]);
      this.log.log(`música gravada na tcheka ${postId}: ${info.seconds.toFixed(1)} s em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    } catch (e) {
      if (e instanceof Skip) {
        await this.pool.query(`UPDATE content.post_music_bakes SET status = 'skipped', error = $2, finished_at = now(), worker_id = NULL WHERE post_id = $1`, [postId, e.message.slice(0, 300)]).catch(() => undefined);
      } else {
        const why = ac.signal.aborted ? 'demorou demais' : (e as Error).message;
        this.log.warn(`gravar a música na tcheka ${postId} falhou: ${why}${e instanceof FfmpegError && e.stderr ? `\n${e.stderr.slice(-1200)}` : ''}`);
        await this.pool.query(`UPDATE content.post_music_bakes SET status = 'failed', error = $2, finished_at = now(), worker_id = NULL WHERE post_id = $1`, [postId, why.slice(0, 300)]).catch(() => undefined);
      }
    } finally {
      clearTimeout(timer);
      clearInterval(beat);
      if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** O vídeo tem som que se ouça (uma pista de áudio acima do silêncio, como na Montagem mágica)? */
  private async audible(file: string, info: { hasAudio: boolean; seconds: number }, cwd: string, signal: AbortSignal): Promise<boolean> {
    if (!info.hasAudio) return false;
    const mono = await decodeMono(file, Math.min(ANALYZE_MAX_S, info.seconds + 0.5), ANALYZE_DECODE_HZ, { cwd, signal });
    const block = Math.max(1, Math.round(ANALYZE_DECODE_HZ / 20));
    for (let i = 0; i < mono.length; i += block) {
      const end = Math.min(mono.length, i + block);
      let s = 0;
      for (let k = i; k < end; k++) s += mono[k] * mono[k];
      if (Math.sqrt(s / (end - i)) >= SILENCE_RMS) return true;
    }
    return false;
  }

  /**
   * De onde vem o som da música guardada na publicação (o formato de MusicService.prepare / SoundsService.prepareUse), com as
   * regras da montagem: um clipe próprio, um som original e uma faixa dos artistas lêem-se do armazenamento privado; uma
   * faixa do catálogo só com licença aberta e de um anfitrião permitido; a licenciada não se grava.
   */
  async audioSource(m: Record<string, unknown>): Promise<AudioSrc> {
    if (m.kind === 'licensed') throw new Skip('música licenciada (não se grava no vídeo)');
    if (m.kind === 'clip') {
      const ok = await this.pool.query(`SELECT 1 FROM content.media_assets WHERE id = $1 AND purpose = 'chat' AND status = 'ready' AND mime LIKE 'audio/%'`, [m.mediaId]);
      if (!ok.rowCount) throw new Skip('o áudio já não existe');
      return { from: 'storage', id: String(m.mediaId), scope: 'private' };
    }
    if (m.kind === 'sound') {
      if (typeof m.audioMediaId !== 'string') throw new Skip('som sem áudio');
      return { from: 'storage', id: m.audioMediaId, scope: 'private' };
    }
    if (m.source === 'local') {
      const ok = await this.pool.query(
        `SELECT 1 FROM content.artist_tracks t JOIN identity.users u ON u.id = t.artist_id
          WHERE t.id::text = $1 AND t.preview_media_id::text = $2 AND t.status IN ('approved', 'withdrawn') AND t.hold_at IS NULL AND u.status = 'active'`,
        [String(m.trackId ?? ''), String(m.previewMediaId ?? '')],
      );
      if (!ok.rowCount) throw new Skip('a faixa do artista não está disponível');
      return { from: 'storage', id: String(m.previewMediaId), scope: 'private' };
    }
    if (!LICENSES.has(String(m.license ?? '').toLowerCase())) throw new Skip('licença que não deixa gravar a faixa');
    let url = typeof m.url === 'string' ? m.url : '';
    try {
      const c = await this.catalog.canonical(String(m.id ?? ''));
      if (c.found) url = c.track.previewUrl;
    } catch {
      throw new Skip('a faixa saiu do catálogo');
    }
    const local = LOCAL_AUDIO.exec(url);
    if (local) return { from: 'storage', id: local[1], scope: 'private' };
    if (!url || !hostOk(url)) throw new Skip('faixa de um sítio que não é permitido');
    return { from: 'url', url };
  }

  private async fetchAudio(src: AudioSrc, dest: string, signal: AbortSignal) {
    if (src.from === 'storage') {
      try {
        await writeFile(dest, await this.media.rawBytes(src.id, src.scope));
      } catch {
        throw new Skip('o áudio já não existe');
      }
      return;
    }
    // Como a montagem: https e só anfitriões permitidos (também nos redireccionamentos, até 4), até 25 MB.
    let at = src.url;
    for (let hop = 0; hop < 4; hop++) {
      if (!hostOk(at)) throw new Skip('faixa de um sítio que não é permitido');
      const res = await this.fetcher(at, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]) });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location');
        if (!next) break;
        at = new URL(next, at).toString();
        continue;
      }
      if (!res.ok || !res.body || (res.headers.get('content-type') ?? '').startsWith('text/')) throw new Error(`a música respondeu ${res.status}`);
      if (Number(res.headers.get('content-length') ?? 0) > MAX_MUSIC_BYTES) throw new Skip('a música é grande demais');
      const fh = await open(dest, 'w');
      let size = 0;
      try {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_MUSIC_BYTES) { await reader.cancel().catch(() => undefined); throw new Skip('a música é grande demais'); }
          await fh.write(value);
        }
      } finally {
        await fh.close();
      }
      if (!size) throw new Error('a música veio vazia');
      return;
    }
    throw new Error('demasiados redireccionamentos');
  }
}

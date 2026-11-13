import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { createReadStream } from 'fs';
import { copyFile, mkdtemp, rename, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Pool } from 'pg';
import { z } from 'zod';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { MediaService } from '../media/media.service';
import { S3Storage } from '../media/s3.storage';
import { encodeWav, reverbImpulse, VOICE_FX_IDS, type VoiceFxId } from './audio';
import { firstProblem } from './compose.schema';
import { ffmpeg, FfmpegError, probe, SAFE_AUDIO } from './ffmpeg';
import { RATE, voiceFxGraph } from './plan';

/** Só se ouve o primeiro minuto (a tcheka tem no máximo 60 s). */
export const VOICE_PREVIEW_MAX_S = 60;
/** Pré-visualizações processadas (não as que já estavam guardadas) por pessoa e por hora. */
export const MAX_VOICE_PREVIEWS_PER_HOUR = 30;
/** Quantas correm ao mesmo tempo (à parte da fila das montagens, para não lhes roubar o servidor) e quantas esperam. */
export const VOICE_PREVIEW_AT_ONCE = 1;
export const VOICE_PREVIEW_MAX_WAITING = 8;
/** Quanto pode esperar pela vez e quanto pode demorar o ffmpeg. */
export const VOICE_PREVIEW_WAIT_MS = 20_000;
export const VOICE_PREVIEW_TIMEOUT_MS = 30_000;
/** Uma pré-visualização guardada só se volta a dar se ainda tiver pelo menos 1 hora antes da limpeza das 48 horas. */
const CACHE_MAX_AGE_HOURS = 47;
/** Muda se a cadeia dos efeitos mudar: as pré-visualizações antigas deixam de se encontrar (e saem nas 48 horas). */
const CACHE_VERSION = 'v1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const voicePreviewSchema = z
  .object({
    mediaId: z.string().regex(UUID, 'O ficheiro não é válido'),
    effect: z
      .enum(VOICE_FX_IDS, { message: 'Efeito de voz desconhecido' })
      .refine((v) => v !== 'normal', 'O efeito Normal é a voz como está: não há nada para pré-visualizar'),
  })
  .strict();

export interface VoicePreview { mediaId: string; url: string; durationMs: number; cached: boolean }

/**
 * O id da pré-visualização de (pessoa, ficheiro, efeito): um UUIDv8 (RFC 9562, «à medida») tirado de um hash. É a chave da
 * cache (sem colunas novas) e a marca das pré-visualizações (os ids normais são UUIDv7), para as contar no limite por hora.
 */
export function previewId(userId: string, sourceId: string, effect: string): string {
  return v8(createHash('sha256').update(`voice-preview:${CACHE_VERSION}:${userId}:${sourceId.toLowerCase()}:${effect}`).digest());
}
/** Um UUIDv8 aleatório (quando o id da cache está ocupado por uma pré-visualização antiga a sair). */
const randomPreviewId = () => v8(randomBytes(16));
function v8(bytes: Buffer): string {
  const b = Buffer.from(bytes.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x80;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** SQL: a linha (alias `t` ou a tabela) é uma pré-visualização de voz (o id é um UUIDv8). */
export const IS_PREVIEW = (col = 'id') => `substr(${col}::text, 15, 1) = '8'`;

/** 1.º passo: o primeiro minuto do som (de um áudio, ou a 1.ª pista de som de um vídeo) em WAV, para saber a duração exata. */
export function voiceDecodeArgs(input: string, out: string): string[] {
  return [
    '-y', ...SAFE_AUDIO, '-t', String(VOICE_PREVIEW_MAX_S), '-i', input,
    '-map', '0:a:0', '-vn', '-threads', '1', '-ac', '2', '-ar', String(RATE), '-c:a', 'pcm_f32le', '-bitexact', '-f', 'wav', out,
  ];
}

/**
 * 2.º passo: o efeito de voz da montagem (`voiceFxGraph`, os mesmos filtros e números, a mesma entrada estéreo a RATE),
 * com exatamente as `samples` amostras da entrada: sem a cauda do eco e do reverb e sem o que o afir e o atempo ainda
 * tenham por entregar no fim (fica silêncio), para os tempos da app baterem 1:1. `ir`: a resposta ao impulso do Estádio
 * (WAV estéreo). Sai AAC num .m4a (MP4), `+faststart`.
 */
export function voicePreviewArgs(effect: VoiceFxId, input: string, ir: string | null, out: string, samples: number): string[] {
  const g = [
    `[0:a]asetpts=PTS-STARTPTS,aresample=${RATE},aformat=sample_fmts=fltp:channel_layouts=stereo[vp_in]`,
    ...voiceFxGraph(effect, '[vp_in]', '[vp_fx]', 'vfx', ir ? '[1:a]' : null),
    `[vp_fx]apad,atrim=end_sample=${Math.max(1, Math.round(samples))}[vp_out]`,
  ];
  return [
    '-y', ...SAFE_AUDIO, '-i', input,
    ...(ir ? [...SAFE_AUDIO, '-i', ir] : []),
    '-filter_complex', g.join(';'),
    '-map', '[vp_out]', '-vn', '-threads', '1',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', String(RATE),
    '-movflags', '+faststart', '-map_metadata', '-1', '-f', 'mp4', out,
  ];
}

/**
 * Pré-visualização dos efeitos de voz no estúdio nativo (POST /tchekas/compose/voice-preview): o som de um ficheiro da
 * própria pessoa (a voz-off, um áudio privado; ou um clipe de vídeo, o som original dele) com o efeito aplicado no servidor
 * com a mesma cadeia da montagem, para se ouvir antes de montar. O resultado é um áudio privado novo (como os do chat:
 * `purpose = 'chat'`, só por URL assinado), pronto e sem uso: a limpeza dos envios por publicar apaga-o 48 horas depois.
 * Não segura o ficheiro de origem (não fica em nenhuma referência de media-refs.ts).
 */
@Injectable()
export class VoicePreviewService {
  private readonly log = new Logger('PreVoz');
  private readonly dir: string;
  private readonly s3: S3Storage | null;
  private readonly inflight = new Map<string, Promise<VoicePreview>>();
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  /** O limite por hora (os testes baixam-no). */
  limit = MAX_VOICE_PREVIEWS_PER_HOUR;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) config: AppConfig,
    private readonly media: MediaService,
  ) {
    this.dir = resolve(config.MEDIA_DIR);
    this.s3 = config.STORAGE_DRIVER === 's3' ? new S3Storage(config) : null;
  }

  async preview(userId: string, raw: unknown): Promise<VoicePreview> {
    const parsed = voicePreviewSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ message: firstProblem(parsed.error.issues), issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const { mediaId, effect } = parsed.data;
    const src = await this.source(userId, mediaId.toLowerCase());
    const id = previewId(userId, src.id, effect);
    // O mesmo pedido já a correr (dois toques seguidos): espera por ele em vez de correr o ffmpeg outra vez.
    const running = this.inflight.get(id);
    if (running) return { ...(await running), cached: true };
    const job = this.resolveOrRender(userId, src, effect, id);
    this.inflight.set(id, job);
    try {
      return await job;
    } finally {
      this.inflight.delete(id);
    }
  }

  /** O ficheiro de origem: meu, pronto, não apagado nem expirado (senão 404, sem dizer se existe); uma foto não tem som. */
  private async source(userId: string, mediaId: string): Promise<{ id: string; mime: string; scope: 'public' | 'private' }> {
    const r = (
      await this.pool.query(
        `SELECT id, mime, purpose FROM content.media_assets
          WHERE id = $1 AND owner_id = $2 AND status = 'ready' AND purpose IN ('public', 'chat') AND (expires_at IS NULL OR expires_at > now())`,
        [mediaId, userId],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Ficheiro não encontrado');
    const mime = r.mime as string;
    if (mime.startsWith('image/')) throw new UnprocessableEntityException('Uma foto não tem som.');
    if (!mime.startsWith('audio/') && !mime.startsWith('video/')) throw new NotFoundException('Ficheiro não encontrado');
    return { id: r.id as string, mime, scope: r.purpose === 'public' ? 'public' : 'private' };
  }

  private async resolveOrRender(userId: string, src: { id: string; mime: string; scope: 'public' | 'private' }, effect: VoiceFxId, id: string): Promise<VoicePreview> {
    const have = (
      await this.pool.query(
        `SELECT status, duration_ms, created_at > now() - make_interval(hours => $3) AS fresh FROM content.media_assets WHERE id = $1 AND owner_id = $2`,
        [id, userId, CACHE_MAX_AGE_HOURS],
      )
    ).rows[0] as { status: string; duration_ms: number | null; fresh: boolean } | undefined;
    if (have && have.status === 'ready' && have.fresh) return { mediaId: id, url: this.media.chatUrl(id), durationMs: Number(have.duration_ms ?? 0), cached: true };

    // Só as processadas contam (também as que estão a correr: a linha entra antes do ffmpeg).
    const recent = (
      await this.pool.query(
        `SELECT count(*)::int AS n FROM content.media_assets WHERE owner_id = $1 AND status <> 'deleted' AND created_at > now() - interval '1 hour' AND ${IS_PREVIEW()}`,
        [userId],
      )
    ).rows[0].n as number;
    if (recent >= this.limit) throw new HttpException('Já ouviste muitos efeitos de voz na última hora. Tenta daqui a um bocado.', HttpStatus.TOO_MANY_REQUESTS);

    // A linha entra já (a processar), com o id da cache; se estiver ocupado (uma antiga a sair na limpeza), com outro.
    const claim = (target: string) =>
      this.pool.query(
        `INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, purpose, status) VALUES ($1, $2, 'audio/mp4', 0, $3, 'chat', 'processing') ON CONFLICT (id) DO NOTHING`,
        [target, userId, target],
      );
    let target = id;
    if (have || !(await claim(id)).rowCount) {
      target = randomPreviewId();
      await claim(target);
    }

    let stored = false;
    try {
      const durationMs = await this.slot(() => this.render(src, effect, target));
      stored = true;
      return { mediaId: target, url: this.media.chatUrl(target), durationMs, cached: false };
    } finally {
      if (!stored) {
        await this.pool.query(`DELETE FROM content.media_assets WHERE id = $1 AND status = 'processing'`, [target]).catch(() => undefined);
        await this.media.purgeFiles(target, 'chat').catch(() => undefined);
      }
    }
  }

  /** Uma vaga para o ffmpeg (VOICE_PREVIEW_AT_ONCE de cada vez; os outros esperam até VOICE_PREVIEW_WAIT_MS). */
  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= VOICE_PREVIEW_AT_ONCE) {
      if (this.waiting.length >= VOICE_PREVIEW_MAX_WAITING) throw new HttpException('Há muitos efeitos a preparar agora. Tenta daqui a pouco.', HttpStatus.SERVICE_UNAVAILABLE);
      await new Promise<void>((ok, fail) => {
        const go = () => { clearTimeout(timer); ok(); };
        const timer = setTimeout(() => {
          const i = this.waiting.indexOf(go);
          if (i >= 0) this.waiting.splice(i, 1);
          fail(new HttpException('Há muitos efeitos a preparar agora. Tenta daqui a pouco.', HttpStatus.SERVICE_UNAVAILABLE));
        }, VOICE_PREVIEW_WAIT_MS);
        this.waiting.push(go);
      });
    } else {
      this.running += 1;
    }
    try {
      return await fn();
    } finally {
      // A vaga passa ao seguinte (sem descer e voltar a subir o contador).
      const next = this.waiting.shift();
      if (next) next();
      else this.running -= 1;
    }
  }

  /** Corre o ffmpeg, guarda o áudio (privado) no id dado e passa a linha a pronta. Devolve a duração em ms. */
  async render(src: { id: string; mime: string; scope: 'public' | 'private' }, effect: VoiceFxId, target: string): Promise<number> {
    const tmp = await mkdtemp(join(tmpdir(), 'txvoicefx-'));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), VOICE_PREVIEW_TIMEOUT_MS);
    try {
      await writeFile(join(tmp, 'src.bin'), await this.media.rawBytes(src.id, src.scope));
      const info = await probe(join(tmp, 'src.bin'), SAFE_AUDIO).catch(() => null);
      if (!info) throw new UnprocessableEntityException('Não consegui ler este ficheiro.');
      if (!info.hasAudio) throw new UnprocessableEntityException(src.mime.startsWith('video/') ? 'Este vídeo não tem som.' : 'Este áudio não tem som.');
      if (effect === 'estadio') await writeFile(join(tmp, 'ir.wav'), encodeWav(reverbImpulse(RATE), RATE));
      try {
        await ffmpeg(voiceDecodeArgs('src.bin', 'src.wav'), { cwd: tmp, signal: ac.signal });
        const n = Math.round((await probe(join(tmp, 'src.wav'), SAFE_AUDIO)).seconds * RATE);
        if (n <= 0) throw new UnprocessableEntityException(src.mime.startsWith('video/') ? 'Este vídeo não tem som.' : 'Este áudio não tem som.');
        await ffmpeg(voicePreviewArgs(effect, 'src.wav', effect === 'estadio' ? 'ir.wav' : null, 'out.m4a', n), { cwd: tmp, signal: ac.signal });
      } catch (e) {
        if (e instanceof HttpException) throw e;
        if (ac.signal.aborted) throw new HttpException('O efeito demorou demais. Tenta com um som mais curto.', HttpStatus.SERVICE_UNAVAILABLE);
        this.log.warn(`efeito ${effect} em ${src.id} falhou: ${(e as Error).message}${e instanceof FfmpegError && e.stderr ? `\n${e.stderr.slice(-800)}` : ''}`);
        throw new UnprocessableEntityException('Não consegui pôr o efeito neste som. Tenta outra vez.');
      }
      const out = join(tmp, 'out.m4a');
      const done = await probe(out);
      if (!done.hasAudio) throw new UnprocessableEntityException('Não consegui pôr o efeito neste som. Tenta outra vez.');
      const size = (await stat(out)).size;
      if (this.s3) await this.s3.put(target, createReadStream(out), 'audio/mp4', 'private', size);
      else {
        await copyFile(out, join(this.dir, `${target}.tmp`));
        await rename(join(this.dir, `${target}.tmp`), join(this.dir, target));
      }
      const durationMs = Math.round(done.seconds * 1000);
      const ok = await this.pool.query(`UPDATE content.media_assets SET status = 'ready', size_bytes = $2, duration_ms = $3 WHERE id = $1 AND status = 'processing'`, [target, size, durationMs]);
      if (!ok.rowCount) throw new Error('a linha da pré-visualização desapareceu');
      return durationMs;
    } finally {
      clearTimeout(timer);
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

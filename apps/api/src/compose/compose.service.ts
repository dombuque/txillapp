import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException,
  OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import { copyFile, mkdtemp, open, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Pool } from 'pg';
import sharp from 'sharp';
import { tierOf } from '../common/badge';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { MediaService } from '../media/media.service';
import { S3Storage } from '../media/s3.storage';
import { signatureSvg, type SealTier } from '../media/signature';
import { MusicCatalogService } from '../music/catalog/catalog.service';
import { hostOk } from '../music/catalog/curation';
import { clipSchema as audioClipSchema, localTrackSchema, trackSchema } from '../music/music.service';
import { tchekaPost } from '../posts/feed';
import { remixAllowed } from '../posts/remix';
import { TextFilter } from '../safety/text-filter.service';
import { canView } from '../social/visibility';
import { parseSoundId, REUSABLE, SOUND_VISIBLE } from '../sounds/sounds.service';
import { stickersSvg } from '../stories/stickers';
import { composeSchema, firstProblem, PHOTO_DEFAULT_MS, type ComposeInput } from './compose.schema';
import { decodeMono, ffmpeg, FfmpegError, probe, SAFE_AUDIO, SAFE_VIDEO } from './ffmpeg';
import { clipArgs, cleanText, finalArgs, FPS, frameSlots, OUT_H, OUT_W, PHOTO_OVERSCAN, DUET, textFilters, type OverlayImage, type TextItem, type Transition } from './plan';
import { beatGrid, checkTcheka, clampTrim, clipSeconds, detectBeats, rhythmDurations, TCHEKA_MAX_S } from './rules';

/** A letra do texto (DejaVu Sans Bold, licença livre: assets/fonts/DejaVu-LICENSE.txt). */
const FONT_CANDIDATES = [resolve(__dirname, '../../assets/fonts/DejaVuSans-Bold.ttf'), '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'];
/** A música de fora descarrega-se só até este tamanho. */
export const MAX_MUSIC_DOWNLOAD = 25 * 1024 * 1024;
/** Montagens por pessoa e por hora (cada uma ocupa o servidor uns segundos). */
export const MAX_JOBS_PER_HOUR = 20;
const LOCAL_AUDIO = /^\/api\/v1\/music\/local\/audio\/([0-9a-f-]{36})(?:[?#]|$)/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Erro com uma frase para a pessoa (o trabalho falha com ela; os outros erros ficam com «Tenta outra vez»). */
export class ComposeRejected extends Error {}

export type JobStatus = 'queued' | 'working' | 'done' | 'failed';
export const RESTART_ERROR = 'O servidor reiniciou a meio da montagem. Tenta outra vez.';

/** De onde vem o som escolhido: um endereço https do catálogo, ou um ficheiro do nosso armazenamento. */
type AudioSrc = { from: 'url'; url: string } | { from: 'storage'; id: string; scope: 'public' | 'private' };

/** O pedido já validado e resolvido: é isto que fica em content.compose_jobs.spec e que o trabalho lê. */
export interface ComposeSpec {
  v: 1;
  username: string;
  seal: SealTier | null;
  clips: { mediaId: string; kind: 'video' | 'photo'; trimStart: number; trimEnd: number; speed: number; seconds: number; beats: number }[];
  audio: { kind: 'music' | 'sound'; src: AudioSrc } | null;
  rhythm: { auto: boolean; bpm: number | null } | null;
  duet: { postId: string; mediaId: string; seconds: number } | null;
  originalVolume: number;
  musicVolume: number;
  transition: Transition;
  filter: string | null;
  texts: { text: string; color: string; bg: string | null; x: number; y: number; size: number; start: number; end: number | null }[];
  stickers: { id: string; x: number; y: number; s: number; r: number; start: number | null; end: number | null }[];
  cover: number | null;
}

/**
 * A montagem das tchekas no servidor (docs/montagem.md), para a app nativa (no telemóvel não há como montar: o ffmpeg-kit
 * foi descontinuado). POST /tchekas/compose valida o pedido com as mesmas regras do estúdio (rules.ts), resolve de onde vêm
 * os clipes e o som, guarda o trabalho e põe-no na fila; a fila, em memória, corre 1 (ou 2) de cada vez, com prioridade
 * baixa e um prazo; o vídeo final fica como um ficheiro público pronto e assinado, para publicar com POST /posts.
 */
@Injectable()
export class ComposeService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Compose');
  private readonly dir: string;
  private readonly s3: S3Storage | null;
  private readonly queue: string[] = [];
  private readonly aborts = new Map<string, AbortController>();
  private readonly lastWrite = new Map<string, number>();
  private running = 0;
  private stopped = false;
  private sweeper?: NodeJS.Timeout;
  /** Quem descarrega a música (os testes trocam-no por um que não sai da máquina). */
  fetcher: typeof fetch = (input, init) => fetch(input, init);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly media: MediaService,
    private readonly catalog: MusicCatalogService,
    private readonly filter: TextFilter,
  ) {
    this.dir = resolve(config.MEDIA_DIR);
    this.s3 = config.STORAGE_DRIVER === 's3' ? new S3Storage(config) : null;
  }

  async onModuleInit() {
    await this.recover().catch((e) => this.log.error(`não consegui retomar as montagens: ${(e as Error).message}`));
    void this.sweepTemp();
    const sweep = () => void this.pool.query(`DELETE FROM content.compose_jobs WHERE status IN ('done', 'failed') AND created_at < now() - interval '7 days'`).catch(() => undefined);
    sweep();
    this.sweeper = setInterval(sweep, 6 * 3600_000);
    this.sweeper.unref();
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.sweeper) clearInterval(this.sweeper);
    for (const a of this.aborts.values()) a.abort();
  }

  /**
   * Depois de um reinício: o que estava a meio passa a `failed` («Tenta outra vez»); o que ainda estava na fila volta a ela.
   * (Público para os testes simularem o reinício.)
   */
  async recover() {
    await this.pool.query(`UPDATE content.compose_jobs SET status = 'failed', error = $1, finished_at = now() WHERE status = 'working'`, [RESTART_ERROR]);
    const { rows } = await this.pool.query(`SELECT id FROM content.compose_jobs WHERE status = 'queued' ORDER BY created_at`);
    for (const r of rows) if (!this.queue.includes(r.id as string)) this.enqueue(r.id as string);
  }

  /** Os diretórios temporários que um processo anterior deixou (caiu a meio de uma montagem), com mais de 1 hora. */
  private async sweepTemp() {
    const base = tmpdir();
    for (const name of await readdir(base).catch(() => [] as string[])) {
      if (!name.startsWith('txcompose-')) continue;
      const at = join(base, name);
      const st = await stat(at).catch(() => null);
      if (st?.isDirectory() && Date.now() - st.mtimeMs > 3600_000) await rm(at, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------ pedido

  async create(userId: string, raw: unknown): Promise<{ jobId: string }> {
    const parsed = composeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ message: firstProblem(parsed.error.issues), issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const spec = await this.resolveSpec(userId, parsed.data);
    const recent = (await this.pool.query(`SELECT count(*)::int AS n FROM content.compose_jobs WHERE owner_id = $1 AND created_at > now() - interval '1 hour'`, [userId])).rows[0].n as number;
    if (recent >= MAX_JOBS_PER_HOUR) throw new HttpException('Já montaste muitas tchekas na última hora. Tenta daqui a um bocado.', HttpStatus.TOO_MANY_REQUESTS);
    const id = uuidv7();
    try {
      await this.pool.query(`INSERT INTO content.compose_jobs (id, owner_id, spec) VALUES ($1, $2, $3)`, [id, userId, JSON.stringify(spec)]);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Já tens uma tcheka a montar. Espera que acabe.');
      throw e;
    }
    this.enqueue(id);
    return { jobId: id };
  }

  async status(userId: string, jobId: string) {
    if (!UUID.test(jobId)) throw new NotFoundException('Montagem não encontrada');
    const r = (await this.pool.query(`SELECT status, progress, media_id, error, duration_ms FROM content.compose_jobs WHERE id = $1 AND owner_id = $2`, [jobId, userId])).rows[0];
    if (!r) throw new NotFoundException('Montagem não encontrada');
    return {
      status: r.status as JobStatus,
      progress: Math.round(Number(r.progress) * 1000) / 1000,
      ...(r.media_id ? { mediaId: r.media_id as string } : {}),
      ...(r.duration_ms ? { durationMs: r.duration_ms as number } : {}),
      ...(r.error ? { error: r.error as string } : {}),
    };
  }

  /** Valida tudo o que se pode validar já (para responder 400 com a dica) e guarda de onde vem cada coisa. */
  private async resolveSpec(userId: string, b: ComposeInput): Promise<ComposeSpec> {
    const me = (await this.pool.query(`SELECT username, verified, verified_tier FROM identity.users WHERE id = $1 AND status = 'active'`, [userId])).rows[0];
    if (!me) throw new ForbiddenException('Conta indisponível');

    // Os clipes: meus, já enviados, prontos e públicos (o upload de sempre).
    const ids = [...new Set(b.clips.map((c) => c.mediaId))];
    const { rows } = await this.pool.query(
      `SELECT id, mime, duration_ms FROM content.media_assets WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND status = 'ready' AND purpose = 'public'`,
      [ids, userId],
    );
    const found = new Map(rows.map((r) => [r.id as string, r]));
    const perPhoto = b.beats?.perPhoto ?? 2;
    const clips = b.clips.map((c, i) => {
      const a = found.get(c.mediaId);
      if (!a) throw new BadRequestException('Um dos clipes não é teu ou ainda não está pronto. Envia-o outra vez.');
      const video = String(a.mime).startsWith('video/');
      if (video !== (c.kind === 'video') || (!video && !String(a.mime).startsWith('image/'))) throw new BadRequestException(`O clipe ${i + 1} não é ${c.kind === 'video' ? 'um vídeo' : 'uma foto'}`);
      if (c.kind === 'video') {
        const length = Math.max(0.5, Number(a.duration_ms ?? 0) / 1000);
        const speed = c.speed ?? 1;
        const trim = clampTrim({ start: (c.trimStartMs ?? 0) / 1000, end: c.trimEndMs !== undefined ? c.trimEndMs / 1000 : length }, length);
        return { mediaId: c.mediaId, kind: 'video' as const, trimStart: trim.start, trimEnd: trim.end, speed, seconds: clipSeconds(trim, speed), beats: perPhoto };
      }
      return { mediaId: c.mediaId, kind: 'photo' as const, trimStart: 0, trimEnd: 0, speed: 1, seconds: (c.durationMs ?? PHOTO_DEFAULT_MS) / 1000, beats: c.beats ?? perPhoto };
    });

    const audio = b.sound ? await this.resolveSound(userId, b.sound) : null;
    const duet = b.duet ? await this.checkDuet(userId, b.duet.postId) : null;
    const photos = clips.some((c) => c.kind === 'photo');
    // Ao ritmo (só com som e fotos): com «auto» o servidor lê as batidas da música; com um BPM, a grelha desse andamento.
    const rhythm = b.beats && audio && photos && (b.beats.mode === 'auto' || b.beats.bpm) ? { auto: b.beats.mode === 'auto', bpm: b.beats.bpm ?? null } : null;
    // As durações para as regras: ao ritmo, com o BPM dado (ou 120); no trabalho usam-se as batidas lidas da música.
    const durations = rhythm ? rhythmDurations(clips.map((c) => ({ video: c.kind === 'video', seconds: c.seconds, beats: c.beats })), beatGrid(rhythm.bpm, 0, TCHEKA_MAX_S + 30)) : clips.map((c) => c.seconds);
    // Os volumes por omissão do estúdio: com um som de outra tcheka o original começa calado; com música, mais baixo.
    const originalVolume = b.originalVolume ?? (audio ? (audio.kind === 'sound' ? 0 : 0.4) : 1);
    const rules = checkTcheka({ clips: clips.map((c, i) => ({ video: c.kind === 'video', seconds: durations[i] })), music: !!audio || !!duet, originalVolume });
    if (!rules.ok) throw new BadRequestException({ message: rules.hint, problem: rules.problem });
    const total = Math.min(rules.total, TCHEKA_MAX_S, duet ? duet.seconds : Infinity);

    // Texto: o filtro de sempre (ameaças, ódio); o que a letra não tem (emojis) sai.
    this.filter.assertClean(...(b.texts ?? []).map((t) => t.text));
    const texts = (b.texts ?? []).map((t) => ({ ...t, text: cleanText(t.text) })).filter((t) => t.text);
    for (const t of texts) if (t.endMs !== undefined && t.endMs <= t.startMs) throw new BadRequestException('O texto tem de sair depois de entrar');
    for (const s of b.stickers ?? []) {
      if ((s.startMs === undefined) !== (s.endMs === undefined)) throw new BadRequestException('O sticker leva o tempo de entrada e o de saída (ou nenhum)');
      if (s.startMs !== undefined && s.endMs! <= s.startMs) throw new BadRequestException('O sticker tem de sair depois de entrar');
    }
    if (b.coverMs !== undefined && b.coverMs / 1000 > total + 0.05) throw new BadRequestException('A capa tem de ser um momento da tcheka');

    return {
      v: 1,
      username: me.username as string,
      seal: tierOf(me.verified, me.verified_tier),
      clips,
      audio,
      rhythm,
      duet,
      originalVolume,
      musicVolume: b.musicVolume ?? 1,
      transition: b.transition ?? 'cut',
      filter: b.filter ?? null,
      texts: texts.map((t) => ({ text: t.text, color: t.color, bg: t.bg ?? null, x: t.x, y: t.y, size: t.size, start: t.startMs / 1000, end: t.endMs !== undefined ? t.endMs / 1000 : null })),
      stickers: (b.stickers ?? []).map((s) => ({ id: s.id, x: s.x, y: s.y, s: s.s, r: s.r, start: s.startMs !== undefined ? s.startMs / 1000 : null, end: s.endMs !== undefined ? s.endMs / 1000 : null })),
      cover: b.coverMs !== undefined ? b.coverMs / 1000 : null,
    };
  }

  /**
   * A música ou o som: as mesmas regras de quando se publica (docs/musica.md e docs/sons.md). Faixa do catálogo: só https e
   * só dos anfitriões permitidos (a lista do catálogo); dos artistas de Moçambique, um clipe próprio e um som original: o
   * ficheiro do nosso armazenamento privado. A música licenciada ainda não se monta aqui.
   */
  private async resolveSound(userId: string, s: NonNullable<ComposeInput['sound']>): Promise<ComposeSpec['audio']> {
    if (s.kind === 'sound') return { kind: 'sound', src: await this.soundSource(userId, s.soundId) };
    const m = s.music;
    if (m.kind === 'licensed') throw new BadRequestException('A música licenciada ainda não dá para montar no servidor');
    if (m.kind === 'clip') {
      const c = audioClipSchema.safeParse(m);
      if (!c.success) throw new BadRequestException('Áudio inválido');
      const ok = await this.pool.query(`SELECT 1 FROM content.media_assets WHERE id = $1 AND owner_id = $2 AND purpose = 'chat' AND status = 'ready' AND mime LIKE 'audio/%'`, [c.data.mediaId, userId]);
      if (!ok.rowCount) throw new BadRequestException('Áudio inválido ou ainda não carregado');
      return { kind: 'music', src: { from: 'storage', id: c.data.mediaId, scope: 'private' } };
    }
    if (m.source === 'local' || (typeof m.id === 'string' && m.id.startsWith('local:'))) {
      const l = localTrackSchema.safeParse({ ...m, source: 'local' });
      if (!l.success) throw new BadRequestException('Música inválida');
      return { kind: 'music', src: await this.trackSource(l.data.id.startsWith('local:') ? l.data.id : `local:${l.data.id}`) };
    }
    const t = trackSchema.safeParse(m);
    if (!t.success) {
      const at = t.error.issues[0]?.path[0];
      if (at === 'url') throw new BadRequestException('Esta música vem de um sítio que não é permitido. Escolhe uma do catálogo.');
      if (at === 'license') throw new BadRequestException('A licença desta música não deixa usá-la numa tcheka');
      throw new BadRequestException('Música inválida');
    }
    const c = await this.catalog.canonical(t.data.id);
    return { kind: 'music', src: c.found ? this.urlSource(c.track.previewUrl) : { from: 'url', url: t.data.url } };
  }

  /** O áudio de uma faixa do catálogo (endereço https) ou dos artistas (o ficheiro privado do trecho). */
  private async trackSource(trackId: string): Promise<AudioSrc> {
    const c = await this.catalog.canonical(trackId);
    if (!c.found) throw new BadRequestException('Esta música já não está disponível');
    return this.urlSource(c.track.previewUrl);
  }

  private urlSource(url: string): AudioSrc {
    const local = LOCAL_AUDIO.exec(url);
    if (local) return { from: 'storage', id: local[1], scope: 'private' };
    if (!hostOk(url)) throw new BadRequestException('Esta música vem de um sítio que não é permitido. Escolhe uma do catálogo.');
    return { from: 'url', url };
  }

  /**
   * «Usar este som» (docs/sons.md), com as regras de SoundsService.prepareUse: um som original (o áudio tirado de outra
   * tcheka) só se usa se existir para quem monta (SOUND_VISIBLE), não estiver em análise e o autor deixar (REUSABLE) ou for o
   * próprio; o som de uma faixa (`cat:<faixa>` ou `local:<uuid>`) é essa faixa.
   */
  private async soundSource(userId: string, soundId: string): Promise<AudioSrc> {
    const ref = parseSoundId(soundId);
    if (!ref) throw new BadRequestException('Som inválido');
    if (ref.kind !== 'original') return this.trackSource(ref.trackId);
    const r = (
      await this.pool.query(
        `SELECT s.audio_media_id, s.hold_at, (ou.id = $1 OR ${REUSABLE()}) AS reusable
           FROM content.sounds s JOIN identity.users ou ON ou.id = s.owner_id
          WHERE s.id = $2 AND s.kind = 'original' AND ${SOUND_VISIBLE()}`,
        [userId, ref.id],
      )
    ).rows[0];
    if (!r || !r.audio_media_id) throw new NotFoundException('Este som já não está disponível');
    if (r.hold_at) throw new ForbiddenException('Este som está em análise e não pode ser usado agora');
    if (!r.reusable) throw new ForbiddenException('Quem publicou este som não deixa usá-lo');
    return { from: 'storage', id: r.audio_media_id as string, scope: 'private' };
  }

  /**
   * As permissões do dueto, as mesmas do remix (posts/remix.ts, `checkRemix` e `remixAllowed`): o original existe e vê-se
   * (privacidade, bloqueios), é uma publicação de uma pessoa (não de um local nem um presente), é uma tcheka, e o dono deixa
   * («Deixar fazer duetos», `remix_allowed`; numa conta privada nunca). O próprio pode sempre.
   */
  private async checkDuet(userId: string, postId: string): Promise<ComposeSpec['duet']> {
    const o = (
      await this.pool.query(
        `SELECT p.kind, p.venue_id, ${tchekaPost()} AS tcheka,
                ${remixAllowed()} AS allowed,
                (SELECT ma.id FROM content.post_media pm JOIN content.media_assets ma ON ma.id = pm.media_id WHERE pm.post_id = p.id AND ma.status = 'ready' LIMIT 1) AS media_id,
                (SELECT ma.duration_ms FROM content.post_media pm JOIN content.media_assets ma ON ma.id = pm.media_id WHERE pm.post_id = p.id LIMIT 1) AS duration_ms
           FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL
          WHERE p.id = $2 AND ${canView()}`,
        [userId, postId],
      )
    ).rows[0];
    if (!o) throw new NotFoundException('Publicação não encontrada');
    if (o.kind !== 'post' || o.venue_id) throw new BadRequestException('Só dá para fazer remix de tchekas e publicações de pessoas');
    if (!o.allowed) throw new ForbiddenException('Esta pessoa não deixa fazer duetos nem responder com tchekas');
    if (!o.tcheka || !o.media_id) throw new BadRequestException('Só dá para fazer dueto com uma tcheka');
    return { postId, mediaId: o.media_id as string, seconds: Math.max(0.5, Number(o.duration_ms ?? 60_000) / 1000) };
  }

  // ------------------------------------------------------------------ fila

  private enqueue(id: string) {
    this.queue.push(id);
    this.pump();
  }

  private pump() {
    while (!this.stopped && this.running < this.config.COMPOSE_CONCURRENCY && this.queue.length) {
      const id = this.queue.shift()!;
      this.running += 1;
      void this.work(id).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  /** O progresso vai para a base de dados no máximo duas vezes por segundo. */
  private progress(id: string, p: number) {
    const now = Date.now();
    if (now - (this.lastWrite.get(id) ?? 0) < 500) return;
    this.lastWrite.set(id, now);
    void this.pool.query(`UPDATE content.compose_jobs SET progress = GREATEST(progress, $2) WHERE id = $1 AND status = 'working'`, [id, Math.max(0, Math.min(0.99, p))]).catch(() => undefined);
  }

  private async work(id: string) {
    const row = (await this.pool.query(`UPDATE content.compose_jobs SET status = 'working', started_at = now(), progress = 0.01 WHERE id = $1 AND status = 'queued' RETURNING owner_id, spec`, [id]).catch(() => ({ rows: [] }))).rows[0];
    if (!row) return;
    const ac = new AbortController();
    this.aborts.set(id, ac);
    const timer = setTimeout(() => ac.abort(), this.config.COMPOSE_TIMEOUT_S * 1000);
    let tmp: string | null = null;
    const t0 = Date.now();
    try {
      tmp = await mkdtemp(join(tmpdir(), 'txcompose-'));
      const out = await this.render(row.spec as ComposeSpec, tmp, ac.signal, (p) => this.progress(id, p));
      const mediaId = await this.store(row.owner_id as string, out);
      await this.pool.query(`UPDATE content.compose_jobs SET status = 'done', progress = 1, media_id = $2, duration_ms = $3, finished_at = now() WHERE id = $1`, [id, mediaId, Math.round(out.seconds * 1000)]);
      const s = (ms: number) => (ms / 1000).toFixed(1);
      this.log.log(`montagem ${id}: ${out.seconds.toFixed(1)} s em ${s(Date.now() - t0)} s (ficheiros ${s(out.timings.prep)}, clipes ${s(out.timings.clips)}, final ${s(out.timings.final)})`);
    } catch (e) {
      const message = e instanceof ComposeRejected
        ? e.message
        : ac.signal.aborted && !this.stopped
          ? 'A montagem demorou demais. Tenta com menos clipes ou uma tcheka mais curta.'
          : this.stopped ? RESTART_ERROR : 'Não consegui montar a tcheka. Tenta outra vez.';
      if (!(e instanceof ComposeRejected)) this.log.error(`montagem ${id} falhou: ${(e as Error).message}${e instanceof FfmpegError && e.stderr ? `\n${e.stderr.slice(-1500)}` : ''}`);
      await this.pool.query(`UPDATE content.compose_jobs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [id, message.slice(0, 300)]).catch(() => undefined);
    } finally {
      clearTimeout(timer);
      this.aborts.delete(id);
      this.lastWrite.delete(id);
      if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------ montagem

  /** Descarrega a música de um anfitrião permitido (https, também nos redireccionamentos), até MAX_MUSIC_DOWNLOAD. */
  private async download(url: string, dest: string, signal: AbortSignal) {
    let at = url;
    for (let hop = 0; hop < 4; hop++) {
      if (!hostOk(at)) throw new ComposeRejected('Esta música vem de um sítio que não é permitido. Escolhe uma do catálogo.');
      let res: Response;
      try {
        res = await this.fetcher(at, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]) });
      } catch {
        throw new ComposeRejected('Não consegui descarregar a música. Tenta outra vez.');
      }
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location');
        if (!next) break;
        at = new URL(next, at).toString();
        continue;
      }
      if (!res.ok || !res.body || (res.headers.get('content-type') ?? '').startsWith('text/')) throw new ComposeRejected('Não consegui descarregar a música. Tenta outra vez.');
      if (Number(res.headers.get('content-length') ?? 0) > MAX_MUSIC_DOWNLOAD) throw new ComposeRejected('A música é grande demais');
      const fh = await open(dest, 'w');
      let size = 0;
      try {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_MUSIC_DOWNLOAD) {
            await reader.cancel().catch(() => undefined);
            throw new ComposeRejected('A música é grande demais');
          }
          await fh.write(value);
        }
      } finally {
        await fh.close();
      }
      if (!size) throw new ComposeRejected('Não consegui descarregar a música. Tenta outra vez.');
      return;
    }
    throw new ComposeRejected('Não consegui descarregar a música. Tenta outra vez.');
  }

  private async fetchAudio(src: AudioSrc, dest: string, signal: AbortSignal) {
    if (src.from === 'url') return this.download(src.url, dest, signal);
    try {
      await writeFile(dest, await this.media.rawBytes(src.id, src.scope));
    } catch {
      throw new ComposeRejected('Este som já não está disponível');
    }
  }

  /** Uma imagem PNG do que vai por cima (stickers ou a assinatura), cortada ao que tem desenho, e onde fica. */
  private async overlayPng(svg: string, file: string): Promise<{ x: number; y: number } | null> {
    try {
      const info = await sharp(Buffer.from(svg)).png().trim().toFile(file);
      return { x: -(info.trimOffsetLeft ?? 0), y: -(info.trimOffsetTop ?? 0) };
    } catch {
      return null; // nada visível (por exemplo, um sticker fora do ecrã)
    }
  }

  /** Monta a tcheka no diretório `tmp`. Ver o topo de plan.ts e docs/montagem.md. */
  async render(spec: ComposeSpec, tmp: string, signal: AbortSignal, onProgress: (p: number) => void) {
    const threads = this.config.COMPOSE_THREADS || undefined;
    const run = (args: string[], onSec?: (s: number) => void) => ffmpeg(args, { cwd: tmp, signal, onProgress: onSec });
    const W = spec.duet ? DUET.w : OUT_W, H = spec.duet ? DUET.h : OUT_H;
    const t0 = Date.now();
    const timings = { prep: 0, clips: 0, final: 0 };

    // 1. Os ficheiros: os clipes (as fotos já no tamanho do quadro, com folga para o zoom), o som e o original do dueto.
    const font = FONT_CANDIDATES.find((f) => existsSync(f));
    if (!font && spec.texts.length) throw new Error('falta a letra DejaVuSans-Bold.ttf');
    if (font) await copyFile(font, join(tmp, 'font.ttf'));
    const inputs = new Map<string, { file: string; hasAudio: boolean; seconds: number }>();
    for (const c of spec.clips) {
      if (inputs.has(c.mediaId)) continue;
      let bytes: Buffer;
      try {
        bytes = await this.media.rawBytes(c.mediaId, 'public');
      } catch {
        throw new ComposeRejected('Um dos clipes já não existe. Envia-o outra vez.');
      }
      if (c.kind === 'video') {
        const file = `in_${inputs.size}.mp4`;
        await writeFile(join(tmp, file), bytes);
        const p = await probe(join(tmp, file), SAFE_VIDEO).catch(() => null);
        if (!p?.hasVideo) throw new ComposeRejected('Um dos vídeos não se consegue ler. Envia-o outra vez.');
        inputs.set(c.mediaId, { file, hasAudio: p.hasAudio, seconds: p.seconds });
      } else {
        const file = `in_${inputs.size}.jpg`;
        await sharp(bytes, { limitInputPixels: 80_000_000 }).rotate().resize(Math.round(W * PHOTO_OVERSCAN), Math.round(H * PHOTO_OVERSCAN), { fit: 'cover' }).jpeg({ quality: 92 }).toFile(join(tmp, file));
        inputs.set(c.mediaId, { file, hasAudio: false, seconds: 0 });
      }
    }
    onProgress(0.04);
    let music: string | null = null;
    if (spec.audio) {
      music = 'music.bin';
      await this.fetchAudio(spec.audio.src, join(tmp, music), signal);
      const p = await probe(join(tmp, music), SAFE_AUDIO).catch(() => null);
      if (!p?.hasAudio) throw new ComposeRejected('Não consegui ler a música. Escolhe outra.');
    }
    let duet: { file: string; hasAudio: boolean; seconds: number } | null = null;
    if (spec.duet) {
      try {
        await writeFile(join(tmp, 'duet.mp4'), await this.media.rawBytes(spec.duet.mediaId, 'public'));
      } catch {
        throw new ComposeRejected('A tcheka do dueto já não está disponível');
      }
      const p = await probe(join(tmp, 'duet.mp4'), SAFE_VIDEO).catch(() => null);
      if (!p?.hasVideo) throw new ComposeRejected('A tcheka do dueto já não está disponível');
      duet = { file: 'duet.mp4', hasAudio: p.hasAudio, seconds: p.seconds };
    }
    onProgress(0.06);

    // 2. As durações: ao ritmo, as fotos acabam nas batidas da música (lidas aqui, como o estúdio faz no browser).
    let durations = spec.clips.map((c) => c.seconds);
    if (spec.rhythm && music) {
      let bpm = spec.rhythm.bpm, offset = 0;
      if (spec.rhythm.auto) {
        const rate = 22_050;
        const samples = await decodeMono(join(tmp, music), TCHEKA_MAX_S + 5, rate, { cwd: tmp, signal }).catch(() => null);
        const info = samples ? detectBeats(samples, rate) : null;
        if (info?.bpm) { bpm = info.bpm; offset = info.offset; }
      }
      durations = rhythmDurations(spec.clips.map((c) => ({ video: c.kind === 'video', seconds: c.seconds, beats: c.beats })), beatGrid(bpm, offset, TCHEKA_MAX_S + 30));
    }
    // As regras outra vez, agora a saber se os vídeos têm som (no pedido ainda não se sabia). Passar dos 60 s só corta.
    const rules = checkTcheka({ clips: spec.clips.map((c, i) => ({ video: c.kind === 'video', seconds: durations[i], hasAudio: c.kind === 'video' ? inputs.get(c.mediaId)!.hasAudio : undefined })), music: !!music || !!duet, originalVolume: spec.originalVolume });
    if (!rules.ok && rules.problem !== 'longo') throw new ComposeRejected(rules.hint ?? 'Não dá para montar esta tcheka');
    const limit = Math.min(TCHEKA_MAX_S, duet ? duet.seconds : Infinity);
    const slots = frameSlots(durations, limit);
    const frames = slots.reduce((n, s) => n + s.frames, 0);
    if (frames < FPS / 2) throw new ComposeRejected('A tcheka ficou curta demais');
    const T = frames / FPS;
    onProgress(0.08);
    timings.prep = Date.now() - t0;

    // 3. 1.º passo: cada clipe no tamanho final, um de cada vez.
    const segs: string[] = [], auds: string[] = [];
    let doneFrames = 0;
    let prevStill: string | null = null;
    for (let i = 0; i < spec.clips.length; i++) {
      const c = spec.clips[i];
      const N = slots[i].frames;
      if (N <= 0) continue;
      const src = inputs.get(c.mediaId)!;
      const out = { video: `seg_${i}.mp4`, audio: `aud_${i}.wav`, last: `last_${i}.png` };
      await run(
        clipArgs({ kind: c.kind, input: src.file, trimStart: c.trimStart, trimLen: Math.max(0.1, c.trimEnd - c.trimStart), speed: c.speed, hasAudio: src.hasAudio, frames: N, w: W, h: H, look: spec.filter, prevStill, transition: spec.transition, out, threads }),
        (s) => onProgress(0.08 + 0.37 * Math.min(1, (doneFrames + s * FPS) / frames)),
      );
      segs.push(out.video);
      auds.push(out.audio);
      prevStill = existsSync(join(tmp, out.last)) ? out.last : null;
      doneFrames += N;
      onProgress(0.08 + 0.37 * (doneFrames / frames));
    }
    timings.clips = Date.now() - t0 - timings.prep;
    await writeFile(join(tmp, 'videos.txt'), segs.map((f) => `file '${f}'`).join('\n') + '\n');
    await writeFile(join(tmp, 'audios.txt'), auds.map((f) => `file '${f}'`).join('\n') + '\n');

    // 4. O que vai por cima: os stickers (cada um no seu tempo) e, no fim, a assinatura do Txillapp (o logótipo, o @ e o selo).
    const overlays: OverlayImage[] = [];
    for (let k = 0; k < spec.stickers.length; k++) {
      const s = spec.stickers[k];
      const at = await this.overlayPng(signatureSvg(OUT_W, OUT_H, null, stickersSvg(OUT_W, OUT_H, [s]), false), join(tmp, `st_${k}.png`));
      if (!at) continue;
      const timed = s.start !== null && s.end !== null && s.start < T;
      if (s.start !== null && !timed) continue; // entra depois do fim
      overlays.push({ file: `st_${k}.png`, ...at, start: timed ? s.start : null, end: timed ? Math.min(T, s.end!) : null });
    }
    const sign = await this.overlayPng(signatureSvg(OUT_W, OUT_H, spec.username, '', true, spec.seal), join(tmp, 'sign.png'));
    if (sign) overlays.push({ file: 'sign.png', ...sign, start: null, end: null });
    const items: TextItem[] = spec.texts
      .filter((t) => t.start < T - 0.1)
      .map((t) => ({ ...t, end: Math.min(T, t.end ?? t.start + 4) }));
    const tx = textFilters(items, OUT_W, OUT_H, 'font.ttf', (i, j) => `text_${i}_${j}.txt`);
    for (const f of tx.files) await writeFile(join(tmp, f.name), f.text, 'utf8');

    // 5. 2.º passo: juntar, dueto, texto, stickers, assinatura e o som; o MP4 final.
    const fin = finalArgs({
      seconds: T, videoList: 'videos.txt', audioList: 'audios.txt',
      music: music ? { file: music, volume: spec.musicVolume } : null,
      duet: duet ? { file: duet.file, hasAudio: duet.hasAudio, volume: spec.musicVolume } : null,
      originalVolume: spec.originalVolume, texts: tx.filters, overlays, out: 'out.mp4', threads,
    }, 'graph.txt');
    await writeFile(join(tmp, 'graph.txt'), fin.graph, 'utf8');
    await run(fin.args, (s) => onProgress(0.45 + 0.5 * Math.min(1, s / T)));
    const final = await probe(join(tmp, 'out.mp4'));
    if (!final.hasVideo || final.seconds <= 0) throw new Error('o vídeo final não se lê');

    // 6. A capa, no momento escolhido (por omissão a 0,5 s, como no estúdio).
    const cover = Math.max(0, Math.min(final.seconds - 0.05, spec.cover ?? Math.min(0.5, final.seconds / 2)));
    await run(['-y', '-ss', cover.toFixed(3), '-i', 'out.mp4', '-frames:v', '1', '-q:v', '3', 'poster.jpg']);
    onProgress(0.98);
    timings.final = Date.now() - t0 - timings.prep - timings.clips;
    return { file: join(tmp, 'out.mp4'), poster: join(tmp, 'poster.jpg'), seconds: final.seconds, width: final.width, height: final.height, timings };
  }

  /** O vídeo final como um ficheiro público, pronto e já assinado (`signed`), à espera de ir num POST /posts. */
  private async store(ownerId: string, out: { file: string; poster: string; seconds: number; width: number; height: number }) {
    const id = uuidv7();
    const size = (await stat(out.file)).size;
    if (this.s3) {
      await this.s3.put(id, createReadStream(out.file), 'video/mp4', 'public', size);
      await this.s3.put(`${id}.poster.jpg`, await readFile(out.poster), 'image/jpeg', 'public');
    } else {
      await copyFile(out.file, join(this.dir, id));
      await copyFile(out.poster, join(this.dir, `${id}.poster.jpg`));
    }
    await this.pool.query(
      `INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, purpose, status, duration_ms, width, height, signed)
       VALUES ($1, $2, 'video/mp4', $3, $7, 'public', 'ready', $4, $5, $6, true)`,
      [id, ownerId, size, Math.round(out.seconds * 1000), out.width, out.height, id],
    );
    return id;
  }
}

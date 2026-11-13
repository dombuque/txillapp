import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException,
  OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import { copyFile, mkdtemp, open, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Pool } from 'pg';
import { loadImage, type Canvas, type Image } from '@napi-rs/canvas';
import sharp from 'sharp';
import { tierOf } from '../common/badge';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { giphyMediaUrl } from '../gifs/gif';
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
import { STICKER_ART } from '../stories/sticker-art';
import { stickersSvg } from '../stories/stickers';
import { encodeWav, renderSfxTrack, reverbImpulse, type SfxCue, type VoiceFxId } from './audio';
import { composeSchema, firstProblem, PHOTO_DEFAULT_MS, type ComposeInput } from './compose.schema';
import { cubeLut, fxSeconds, REVERSE_MAX_S, resolveFx, sanitizeFx, sanitizeOverlay, sanitizePano, transitionFor, type CapulanaSpec, type ClipFx, type Overlay, type TransitionId } from './effects';
import { needsLut, photoOnCanvas, rampMaxSpeed, reverseChunks, reverseTooLong, serverFxChain } from './fx';
import { gifReader, renderLayers, renderPhotoFrames, renderTransitionHead, stillFramesOf, type StickerImages } from './studio-canvas';
import { decodeMono, ffmpeg, FfmpegError, ffmpegSink, probe, SAFE_AUDIO, SAFE_VIDEO } from './ffmpeg';
import { clipArgs, reverseChunkArgs, cleanText, finalArgs, FPS, frameSlots, OUT_H, OUT_W, PHOTO_OVERSCAN, DUET, RATE, textFilters, type OverlayImage, type TextItem, type Transition } from './plan';
import { beatGrid, checkTcheka, clampTrim, clipSeconds, detectBeats, MIN_VOICE_S, rhythmDurations, TCHEKA_MAX_S } from './rules';

/** A letra do texto (DejaVu Sans Bold, licença livre: assets/fonts/DejaVu-LICENSE.txt). */
const FONT_CANDIDATES = [resolve(__dirname, '../../assets/fonts/DejaVuSans-Bold.ttf'), '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'];
/** A música de fora descarrega-se só até este tamanho. */
export const MAX_MUSIC_DOWNLOAD = 25 * 1024 * 1024;
/**
 * No modo estúdio, quantos clipes se montam ao mesmo tempo (o grafo de filtros de cada ffmpeg corre num fio, e a cor do
 * estúdio pesa nele; dois ffmpeg em paralelo usam melhor os núcleos, com ~0,3–0,5 GB cada um).
 */
export const STUDIO_CLIPS_AT_ONCE = 2;
/** O pano de capulana de uma tcheka que não diga o dela (o `DEFAULT_PANO` do estúdio do site). */
export const DEFAULT_PANO: CapulanaSpec = { pattern: 'losangos', palette: 'coral', seed: 1 };
/** Um GIF do GIPHY descarrega-se só até este tamanho. */
export const MAX_GIF_DOWNLOAD = 8 * 1024 * 1024;
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
  clips: { mediaId: string; kind: 'video' | 'photo'; trimStart: number; trimEnd: number; speed: number; seconds: number; beats: number; fx?: ClipFx; /** o volume do som deste vídeo (0 = calado; sem o campo, 1) */ vol?: number }[];
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
  /** O som do estúdio (docs/montagem.md, «O som»). Opcional: os trabalhos de antes não o têm. */
  mix?: ComposeMix;
  /**
   * Os efeitos do estúdio (docs/estudio-efeitos.md): com `fx` em algum clipe ou com `overlays`, cada clipe leva a transição
   * dele (por omissão o fundido de 0,5 s, como no site) e as camadas desenham-se no canvas como no site.
   */
  studio?: boolean;
  overlays?: Overlay[];
  /** O pano de capulana da tcheka (o das transições de pano sem pano próprio). */
  pano?: CapulanaSpec;
}

/** O trecho, os fades, o ducking, a voz-off, os efeitos de voz e os efeitos sonoros (tempos em segundos). */
export interface ComposeMix {
  musicStart: number;
  fadeIn: number;
  fadeOut: number;
  ducking: boolean;
  originalFx: VoiceFxId;
  voice: { mediaId: string; start: number; volume: number; fx: VoiceFxId } | null;
  sfx: SfxCue[];
  sfxVolume: number;
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
    const studio = b.clips.some((c) => c.fx) || b.overlays !== undefined;
    if (studio && (b.transition !== undefined || b.filter !== undefined)) {
      throw new BadRequestException('Com os efeitos do estúdio (fx), a transição e o filtro vão em cada clipe');
    }
    const keys = new Set(b.clips.map((c) => c.id).filter((k): k is string => !!k));
    const clips = b.clips.map((c, i) => {
      const a = found.get(c.mediaId);
      if (!a) throw new BadRequestException('Um dos clipes não é teu ou ainda não está pronto. Envia-o outra vez.');
      const fx = sanitizeFx(c.fx);
      if (c.kind === 'photo' && (fx?.ramp || fx?.reverse)) throw new BadRequestException('A rampa e o inverter são só para vídeos');
      if (c.kind === 'video' && fx?.freeze) throw new BadRequestException('Um frame congelado vai como uma foto');
      if (c.kind === 'video' && (fx?.focus || fx?.moldura)) throw new BadRequestException('O enquadramento e a moldura são só para fotos');
      if (c.kind === 'photo' && (c.sound !== undefined || c.volume !== undefined)) throw new BadRequestException('O som e o volume são só para vídeos');
      // «Som do vídeo»: calado ou com o volume do clipe (como `soundOn` no estúdio).
      const vol = c.sound === false ? 0 : c.volume ?? 1;
      const snd = vol < 1 ? { vol } : {};
      if (fx?.freeze && keys.size && !keys.has(fx.freeze.from)) throw new BadRequestException('O frame congelado tem de vir de um clipe desta tcheka');
      const video = String(a.mime).startsWith('video/');
      if (video !== (c.kind === 'video') || (!video && !String(a.mime).startsWith('image/'))) throw new BadRequestException(`O clipe ${i + 1} não é ${c.kind === 'video' ? 'um vídeo' : 'uma foto'}`);
      if (c.kind === 'video') {
        const length = Math.max(0.5, Number(a.duration_ms ?? 0) / 1000);
        const speed = c.speed ?? 1;
        const trim = clampTrim({ start: (c.trimStartMs ?? 0) / 1000, end: c.trimEndMs !== undefined ? c.trimEndMs / 1000 : length }, length);
        if (fx?.reverse && reverseTooLong(trim.end - trim.start)) throw new BadRequestException(`Para inverter, o clipe pode ter até ${REVERSE_MAX_S} s`);
        // Com rampa, a duração muda (fxSeconds, como no estúdio); sem ela é o corte à velocidade.
        const seconds = fx?.ramp ? fxSeconds(trim.end - trim.start, speed, fx) : clipSeconds(trim, speed);
        return { mediaId: c.mediaId, kind: 'video' as const, trimStart: trim.start, trimEnd: trim.end, speed, seconds, beats: perPhoto, ...(fx ? { fx } : {}), ...snd };
      }
      return { mediaId: c.mediaId, kind: 'photo' as const, trimStart: 0, trimEnd: 0, speed: 1, seconds: (c.durationMs ?? PHOTO_DEFAULT_MS) / 1000, beats: c.beats ?? perPhoto, ...(fx ? { fx } : {}) };
    });

    const audio = b.sound ? await this.resolveSound(userId, b.sound) : null;
    const duet = b.duet ? await this.checkDuet(userId, b.duet.postId) : null;
    const photos = clips.some((c) => c.kind === 'photo');
    // Ao ritmo (só com som e fotos): com «auto» o servidor lê as batidas da música; com um BPM, a grelha desse andamento.
    const rhythm = b.beats && audio && photos && (b.beats.mode === 'auto' || b.beats.bpm) ? { auto: b.beats.mode === 'auto', bpm: b.beats.bpm ?? null } : null;
    // As durações para as regras: ao ritmo, com o BPM dado (ou 120); no trabalho usam-se as batidas lidas da música.
    const durations = rhythm ? rhythmDurations(clips.map((c) => ({ video: c.kind === 'video', seconds: c.seconds, beats: c.beats })), beatGrid(rhythm.bpm, 0, TCHEKA_MAX_S + 30)) : clips.map((c) => c.seconds);
    // Os volumes por omissão do estúdio: com um som de outra tcheka o original começa calado; com música, mais baixo.
    // (Como o estúdio integrado: o som dos vídeos a 100 %; a música a 70 % quando há vídeos, para se ouvirem por cima.)
    const originalVolume = b.originalVolume ?? (audio?.kind === 'sound' ? 0 : 1);
    const musicVolume = b.musicVolume ?? (audio?.kind === 'music' && clips.some((c) => c.kind === 'video') ? 0.7 : 1);
    // A voz-off: um áudio meu, enviado e pronto, do armazenamento privado. Conta como o som com 3 s ou mais dentro da tcheka
    // (se ainda não se souber quanto dura, conta; no trabalho volta a contar-se com a duração verdadeira).
    const voice = b.voiceOver ? await this.checkVoice(userId, b.voiceOver.mediaId) : null;
    const sum = durations.reduce((x, d) => x + d, 0);
    const voiceSeconds = voice && b.voiceOver ? (voice.seconds !== null ? Math.max(0, Math.min(b.voiceOver.startMs / 1000 + voice.seconds, sum) - b.voiceOver.startMs / 1000) : MIN_VOICE_S) : 0;
    // Um vídeo ao contrário fica com o som calado (não conta para o som obrigatório, como no estúdio).
    const rules = checkTcheka({ clips: clips.map((c, i) => ({ video: c.kind === 'video', seconds: durations[i], ...(c.fx?.reverse || (c as { vol?: number }).vol === 0 ? { hasAudio: false } : {}) })), music: !!audio || !!duet, originalVolume, voiceSeconds });
    if (!rules.ok) throw new BadRequestException({ message: rules.hint, problem: rules.problem });
    const total = Math.min(rules.total, TCHEKA_MAX_S, duet ? duet.seconds : Infinity);

    // Texto: o filtro de sempre (ameaças, ódio); o que a letra não tem (emojis) sai.
    // As camadas do estúdio: limpas como o site as lê (sanitizeOverlay); os textos, os locais e as menções passam pelo filtro.
    const overlays = (b.overlays ?? []).map((o) => sanitizeOverlay(o)).filter((o): o is Overlay => !!o);
    const said = overlays.flatMap((o) => (o.kind === 'text' ? [o.text] : o.sticker.type === 'location' ? [o.sticker.name] : o.sticker.type === 'mention' ? [o.sticker.username] : []));
    this.filter.assertClean(...(b.texts ?? []).map((t) => t.text), ...said);
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
      musicVolume,
      transition: b.transition ?? 'cut',
      filter: b.filter ?? null,
      texts: texts.map((t) => ({ text: t.text, color: t.color, bg: t.bg ?? null, x: t.x, y: t.y, size: t.size, start: t.startMs / 1000, end: t.endMs !== undefined ? t.endMs / 1000 : null })),
      stickers: (b.stickers ?? []).map((s) => ({ id: s.id, x: s.x, y: s.y, s: s.s, r: s.r, start: s.startMs !== undefined ? s.startMs / 1000 : null, end: s.endMs !== undefined ? s.endMs / 1000 : null })),
      cover: b.coverMs !== undefined ? b.coverMs / 1000 : null,
      mix: {
        musicStart: (b.musicStartMs ?? 0) / 1000,
        fadeIn: (b.musicFadeInMs ?? 0) / 1000,
        fadeOut: (b.musicFadeOutMs ?? 0) / 1000,
        ducking: b.ducking ?? true,
        originalFx: b.originalEffect ?? 'normal',
        voice: b.voiceOver ? { mediaId: b.voiceOver.mediaId, start: b.voiceOver.startMs / 1000, volume: b.voiceOver.volume, fx: b.voiceOver.effect } : null,
        sfx: (b.soundEffects ?? []).map((s) => ({ id: s.id, at: s.atMs / 1000 })),
        sfxVolume: b.soundEffectsVolume ?? 1,
      },
      ...(studio ? { studio: true, overlays, pano: sanitizePano(b.pano) ?? DEFAULT_PANO } : {}),
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

  /**
   * A voz-off: um áudio de quem monta, já enviado e pronto, como os clipes de áudio (`purpose: 'chat'`: fica no armazenamento
   * privado e nunca se serve em público; o vídeo final é que leva a voz misturada).
   */
  private async checkVoice(userId: string, mediaId: string): Promise<{ seconds: number | null }> {
    const r = (await this.pool.query(`SELECT duration_ms FROM content.media_assets WHERE id = $1 AND owner_id = $2 AND purpose = 'chat' AND status = 'ready' AND mime LIKE 'audio/%'`, [mediaId, userId])).rows[0];
    if (!r) throw new BadRequestException('A voz-off não é tua ou ainda não está pronta. Envia-a outra vez.');
    return { seconds: r.duration_ms ? Number(r.duration_ms) / 1000 : null };
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
      const fx = out.timings.layers || out.timings.transitions || out.timings.reverse ? `; estúdio: camadas ${s(out.timings.layers)}, transições ${s(out.timings.transitions)}, inverter ${s(out.timings.reverse)}` : '';
      this.log.log(`montagem ${id}: ${out.seconds.toFixed(1)} s em ${s(Date.now() - t0)} s (ficheiros ${s(out.timings.prep)}, clipes ${s(out.timings.clips)}, final ${s(out.timings.final)}${fx})`);
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

  /**
   * Um GIF do GIPHY (docs/estudio-efeitos.md, stickers): só https e só dos anfitriões de média do GIPHY, também nos
   * redireccionamentos (o mesmo que gifs/gif.ts aceita), até MAX_GIF_DOWNLOAD.
   */
  private async downloadGif(url: string, signal: AbortSignal): Promise<Buffer> {
    let at = url;
    for (let hop = 0; hop < 4; hop++) {
      if (!giphyMediaUrl(at)) throw new ComposeRejected('O GIF tem de vir do GIPHY');
      let res: Response;
      try {
        res = await this.fetcher(at, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
      } catch {
        throw new ComposeRejected('Não consegui descarregar um dos GIFs. Tenta outra vez.');
      }
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location');
        if (!next) break;
        at = new URL(next, at).toString();
        continue;
      }
      if (!res.ok || !res.body || Number(res.headers.get('content-length') ?? 0) > MAX_GIF_DOWNLOAD) throw new ComposeRejected('Não consegui descarregar um dos GIFs. Tenta outra vez.');
      const parts: Buffer[] = [];
      let size = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_GIF_DOWNLOAD) { await reader.cancel().catch(() => undefined); throw new ComposeRejected('Um dos GIFs é grande demais'); }
        parts.push(Buffer.from(value));
      }
      return Buffer.concat(parts);
    }
    throw new ComposeRejected('Não consegui descarregar um dos GIFs. Tenta outra vez.');
  }

  /**
   * As imagens dos stickers do estúdio: os do Txillapp (a arte dos mimos, em PNG pelo sharp) e os GIFs (descarregados do
   * GIPHY; o GIF lê-se pelo ffmpeg em ciclo, `-ignore_loop 0`, e o WebP animado pelo sharp, que o ffmpeg 6 não lê).
   */
  private async stickerImages(overlays: Overlay[], tmp: string, signal: AbortSignal): Promise<{ images: StickerImages; close: () => Promise<void> }> {
    const still = new Map<string, { img: Canvas | Image; w: number; h: number }>();
    type Gif = { kind: 'gif'; file: string; gw: number; gh: number } | { kind: 'webp'; frames: Canvas[]; delays: number[]; gw: number; gh: number };
    const gifs = new Map<string, Gif>();
    for (const o of overlays) {
      if (o.kind !== 'sticker') continue;
      // A maior escala que a camada atinge (pop e pulsar), para a imagem não ficar desfocada.
      const S = Math.min(4, o.scale * 1.18);
      if (o.sticker.type === 'txill') {
        const art = STICKER_ART[o.sticker.id];
        if (!art) continue;
        const [, , vw, vh] = art.vb.split(/\s+/).map(Number);
        const ratio = (vh || 100) / (vw || 100);
        const w = Math.round(400 * S);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${art.vb}" width="${w}" height="${Math.round(w * ratio)}">${art.body}</svg>`;
        still.set(o.id, { img: await loadImage(await sharp(Buffer.from(svg)).png().toBuffer()), w: 1, h: ratio });
      } else if (o.sticker.type === 'gif') {
        const bytes = await this.downloadGif(o.sticker.url, signal);
        const head = bytes.subarray(0, 12).toString('latin1');
        const isGif = head.startsWith('GIF8');
        const isWebp = head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP';
        const meta = isGif || isWebp ? await sharp(bytes, { animated: true, limitInputPixels: 40_000_000 }).metadata().catch(() => null) : null;
        const h0 = meta?.pageHeight ?? meta?.height;
        if (!meta?.width || !h0) throw new ComposeRejected('Um dos GIFs não se consegue ler. Escolhe outro.');
        const gw = Math.max(16, Math.min(1080, Math.round(440 * S)));
        const gh = Math.max(16, Math.min(1920, Math.round((gw * h0) / meta.width)));
        if (isGif) {
          const file = `gif_${gifs.size}.gif`;
          await writeFile(join(tmp, file), bytes);
          gifs.set(o.id, { kind: 'gif', file, gw, gh });
        } else gifs.set(o.id, { kind: 'webp', ...(await stillFramesOf(bytes, gw, gh)), gw, gh });
      }
    }
    const readers = new Map<string, ReturnType<typeof gifReader>>();
    const images: StickerImages = {
      still: (o) => still.get(o.id) ?? null,
      gifFrame: async (o, k) => {
        const g = gifs.get(o.id);
        if (!g) return null;
        if (g.kind === 'webp') {
          // O frame do instante (k − k0)/30, em ciclo, pelos tempos de cada frame.
          const total = g.delays.reduce((a, b) => a + b, 0) || 1;
          let ms = (((k - Math.ceil(o.start * FPS - 1e-6)) / FPS) * 1000) % total;
          let i = 0;
          while (i < g.delays.length - 1 && ms >= g.delays[i]) { ms -= g.delays[i]; i++; }
          return { img: g.frames[i], w: g.gw, h: g.gh };
        }
        let r = readers.get(o.id);
        if (!r) {
          r = gifReader(g.file, { seconds: Math.max(0.1, o.end - o.start + 0.2), gw: g.gw, gh: g.gh, cwd: tmp, signal });
          readers.set(o.id, r);
        }
        return { img: await r.next(), w: g.gw, h: g.gh };
      },
    };
    return { images, close: async () => { for (const r of readers.values()) await r.close(); } };
  }

  /**
   * Inverter um vídeo (docs/estudio-efeitos.md, 4): o corte já no quadro, do fim para o início, aos bocados (o `reverse` guarda
   * o bocado em memória), junto num ficheiro só que depois se monta como um vídeo normal (desde 0, com a rampa e a velocidade).
   */
  private async reversed(i: number, input: string, c: ComposeSpec['clips'][number], W: number, H: number, tmp: string, run: (args: string[]) => Promise<void>, threads?: number): Promise<string> {
    const len = Math.max(0.1, c.trimEnd - c.trimStart);
    // Com velocidade ou rampa acima de 1×, tiram-se 60 frames por segundo da fonte (o vídeo final não fica aos saltos).
    const fps = c.speed * rampMaxSpeed(c.fx) > 1 ? 60 : FPS;
    const parts = reverseChunks(len, fps > FPS ? 1 : 2);
    const files: string[] = [];
    for (let j = 0; j < parts.length; j++) {
      const out = `rev_${i}_${j}.mp4`;
      await run(reverseChunkArgs({ input, from: c.trimStart + parts[j].from, len: parts[j].len, fps, w: W, h: H, out, threads }));
      files.push(out);
    }
    await writeFile(join(tmp, `rev_${i}.txt`), files.map((f) => `file '${f}'`).join('\n') + '\n');
    await run(['-y', '-f', 'concat', '-safe', '0', '-i', `rev_${i}.txt`, '-c', 'copy', `rev_${i}.mp4`]);
    for (const f of files) await rm(join(tmp, f), { force: true });
    return `rev_${i}.mp4`;
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
    // `layers`, `transitions` e `reverse`: o tempo de cada parte do estúdio (as camadas correm ao mesmo tempo que os clipes).
    const timings = { prep: 0, clips: 0, final: 0, layers: 0, transitions: 0, reverse: 0 };

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
    const mix = spec.mix ?? null;
    let voice: { file: string; seconds: number } | null = null;
    if (mix?.voice) {
      try {
        await writeFile(join(tmp, 'voice.bin'), await this.media.rawBytes(mix.voice.mediaId, 'private'));
      } catch {
        throw new ComposeRejected('A voz-off já não está disponível. Grava-a outra vez.');
      }
      const p = await probe(join(tmp, 'voice.bin'), SAFE_AUDIO).catch(() => null);
      if (!p?.hasAudio) throw new ComposeRejected('Não consegui ler a voz-off. Grava-a outra vez.');
      voice = { file: 'voice.bin', seconds: p.seconds };
    }
    onProgress(0.06);

    // 2. As durações: ao ritmo, as fotos acabam nas batidas da música (lidas aqui, como o estúdio faz no browser).
    let durations = spec.clips.map((c) => c.seconds);
    if (spec.rhythm && music) {
      let bpm = spec.rhythm.bpm, offset = 0;
      if (spec.rhythm.auto) {
        const rate = 22_050;
        // As batidas do trecho escolhido (como o estúdio: a detectBeats a partir de musicStartMs).
        const samples = await decodeMono(join(tmp, music), TCHEKA_MAX_S + 5, rate, { cwd: tmp, signal, startS: mix?.musicStart ?? 0 }).catch(() => null);
        const info = samples ? detectBeats(samples, rate) : null;
        if (info?.bpm) { bpm = info.bpm; offset = info.offset; }
      }
      durations = rhythmDurations(spec.clips.map((c) => ({ video: c.kind === 'video', seconds: c.seconds, beats: c.beats })), beatGrid(bpm, offset, TCHEKA_MAX_S + 30));
    }
    // As regras outra vez, agora a saber se os vídeos têm som e quanto dura a voz-off (no pedido ainda não se sabia).
    // Passar dos 60 s só corta.
    const limit = Math.min(TCHEKA_MAX_S, duet ? duet.seconds : Infinity);
    const until = Math.min(limit, durations.reduce((x, d) => x + d, 0));
    const voiceSeconds = voice && mix?.voice ? Math.max(0, Math.min(mix.voice.start + voice.seconds, until) - mix.voice.start) : 0;
    const rules = checkTcheka({ clips: spec.clips.map((c, i) => ({ video: c.kind === 'video', seconds: durations[i], hasAudio: c.kind === 'video' ? inputs.get(c.mediaId)!.hasAudio && !(spec.studio && c.fx?.reverse) && c.vol !== 0 : undefined })), music: !!music || !!duet, originalVolume: spec.originalVolume, voiceSeconds });
    if (!rules.ok && rules.problem !== 'longo') throw new ComposeRejected(rules.hint ?? 'Não dá para montar esta tcheka');
    const slots = frameSlots(durations, limit);
    const frames = slots.reduce((n, s) => n + s.frames, 0);
    if (frames < FPS / 2) throw new ComposeRejected('A tcheka ficou curta demais');
    const T = frames / FPS;
    onProgress(0.08);
    timings.prep = Date.now() - t0;

    // As camadas do estúdio (texto e stickers), desenhadas como no site (renderOverlays.ts no canvas do Node). Não dependem
    // do vídeo: desenham-se enquanto o ffmpeg monta os clipes (o canvas corre no fio do Node, o ffmpeg nos dele).
    const studio = !!spec.studio;
    // Se um clipe falhar, as camadas param antes de o diretório do trabalho se apagar.
    const stopLayers = new AbortController();
    const layersSignal = AbortSignal.any([signal, stopLayers.signal]);
    const layersJob = studio && spec.overlays?.length
      ? (async () => {
        const l0 = Date.now();
        const st = await this.stickerImages(spec.overlays!, tmp, layersSignal);
        try {
          return await renderLayers(spec.overlays!, frames, st.images, { cwd: tmp, signal: layersSignal });
        } finally {
          await st.close();
          timings.layers = Date.now() - l0;
        }
      })()
      : null;
    layersJob?.catch(() => undefined); // o erro aparece no await, mais abaixo

    // 3. 1.º passo: cada clipe no tamanho final. Os de sempre vão um de cada vez (a transição do clipe i usa, no próprio
    // ffmpeg, o último frame do anterior). No modo estúdio os clipes não dependem uns dos outros (a transição desenha-se
    // depois, no canvas, com o último frame do anterior e o início deste): vão STUDIO_CLIPS_AT_ONCE de cada vez (o grafo de
    // filtros do ffmpeg corre num fio só, e a cor do estúdio pesa nele) e cada transição desenha-se logo que os dois lados
    // estão prontos (os frames em RGBA não se acumulam no disco).
    const segs: string[] = [], auds: string[] = [];
    let doneFrames = 0;
    const live = new Map<number, number>();
    const tick = () => onProgress(0.08 + 0.37 * Math.min(1, (doneFrames + [...live.values()].reduce((x, y) => x + y, 0) * FPS) / frames));
    const order = spec.clips.map((_, i) => i).filter((i) => slots[i].frames > 0);
    const prevOf = new Map(order.map((i, k) => [i, k > 0 ? order[k - 1] : -1]));
    const heads = new Map<number, { frames: number; file: string; type: TransitionId; dur: number; pano: CapulanaSpec }>();
    const finished = new Set<number>(), drawn = new Set<number>(), claimed = new Set<number>();
    const clipJob = async (i: number, prevStill: string | null) => {
      const c = spec.clips[i];
      const N = slots[i].frames;
      const src = inputs.get(c.mediaId)!;
      const out = { video: `seg_${i}.mp4`, audio: `aud_${i}.wav`, last: `last_${i}.png` };
      // Os efeitos do estúdio: ao contrário (um ficheiro invertido, sem som), a cor numa LUT 3D (gerada de effects.ts) e a
      // transição de entrada desenhada no canvas como no site (os primeiros frames saem em RGBA para isso).
      let input = src.file, trimStart = c.trimStart, hasAudio = src.hasAudio;
      if (studio && c.kind === 'video' && c.fx?.reverse) {
        const r0 = Date.now();
        input = await this.reversed(i, src.file, c, W, H, tmp, (a) => run(a));
        timings.reverse += Date.now() - r0;
        trimStart = 0;
        hasAudio = false;
      }
      let lut: string | undefined;
      if (studio && needsLut(c.fx)) {
        lut = `lut_${i}.cube`;
        await writeFile(join(tmp, lut), cubeLut(resolveFx(c.fx).matrix, 33));
      }
      const tr = studio && prevOf.get(i)! >= 0 ? transitionFor(c.fx, i, N / FPS) : null;
      const headFrames = tr ? Math.min(N - 1, Math.ceil(tr.dur * FPS - 1e-6)) : 0;
      const head = headFrames > 0 ? { frames: headFrames, file: `head_${i}.rgba` } : undefined;
      const job = {
        kind: c.kind, input, trimStart, trimLen: Math.max(0.1, c.trimEnd - c.trimStart), speed: c.speed, hasAudio, frames: N, w: W, h: H,
        look: studio ? null : spec.filter, prevStill, transition: spec.transition, out, threads, volume: c.vol ?? 1,
        ...(studio ? { fx: c.fx ?? {}, lut, head } : {}),
      };
      if (studio && c.kind === 'photo' && photoOnCanvas(c.fx)) {
        // A moldura de capulana e o enquadramento: os frames desenham-se no canvas (como o drawBase do site) e o ffmpeg
        // recebe-os pelo stdin. Na moldura, o filtro e os ajustes vão só na foto (até 1440 px de lado, como no site).
        const fx = c.fx!;
        const raw = await this.media.rawBytes(c.mediaId, 'public');
        const base = sharp(raw, { limitInputPixels: 80_000_000 }).rotate();
        let image: Buffer;
        if (fx.moldura) {
          image = await base.resize(1440, 1440, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
          const chain = serverFxChain(fx, lut ?? 'clip.cube').split(',format=yuv420p,noise=')[0];
          if (chain) {
            await writeFile(join(tmp, `mold_${i}.png`), image);
            await run(['-y', '-i', `mold_${i}.png`, '-vf', `${chain},format=rgb24`, '-frames:v', '1', '-update', '1', `moldfx_${i}.png`]);
            image = await readFile(join(tmp, `moldfx_${i}.png`));
          }
        } else image = await base.resize(Math.round(W * PHOTO_OVERSCAN), Math.round(H * PHOTO_OVERSCAN), { fit: 'outside' }).jpeg({ quality: 92 }).toBuffer();
        const sink = ffmpegSink(clipArgs({ ...job, kind: 'canvas', noColor: !!fx.moldura }), { cwd: tmp, signal });
        try {
          await renderPhotoFrames({ image, frames: N, W, H, fx, write: (f) => sink.write(f) });
        } catch (e) {
          await sink.end().catch(() => undefined);
          throw e;
        }
        await sink.end();
      } else await run(clipArgs(job), (sec) => { live.set(i, sec); tick(); });
      live.delete(i);
      doneFrames += N;
      tick();
      if (head && tr) heads.set(i, { ...head, type: tr.type, dur: tr.dur, pano: tr.pano ?? spec.pano ?? DEFAULT_PANO });
      finished.add(i);
    };
    /** As transições cujos dois clipes já estão prontos. */
    const drawHeads = async () => {
      for (const [i, h] of heads) {
        const p = prevOf.get(i)!;
        if (claimed.has(i) || !finished.has(i) || !finished.has(p)) continue;
        claimed.add(i);
        const h0 = Date.now();
        const prev = existsSync(join(tmp, `last_${p}.png`)) ? `last_${p}.png` : null;
        await renderTransitionHead({ prev, head: h.file, frames: h.frames, type: prev ? h.type : 'corte', dur: h.dur, W, H, out: `segh_${i}.mp4`, cwd: tmp, signal, threads, pano: h.pano });
        timings.transitions += Date.now() - h0;
        await rm(join(tmp, h.file), { force: true });
        drawn.add(i);
      }
    };
    try {
      if (studio) {
        let next = 0, failed = false;
        const worker = async () => {
          try {
            while (next < order.length && !failed) {
              await clipJob(order[next++], null);
              await drawHeads();
            }
          } catch (e) {
            failed = true; // o outro não começa mais nenhum; espera-se por ele antes de apagar o diretório
            throw e;
          }
        };
        const ended = await Promise.allSettled(Array.from({ length: Math.min(STUDIO_CLIPS_AT_ONCE, order.length) }, worker));
        const bad = ended.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (bad) throw bad.reason;
        await drawHeads();
      } else {
        let prevStill: string | null = null;
        for (const i of order) {
          await clipJob(i, prevStill);
          prevStill = existsSync(join(tmp, `last_${i}.png`)) ? `last_${i}.png` : null;
        }
      }
    } catch (e) {
      stopLayers.abort();
      await layersJob?.catch(() => undefined);
      throw e;
    }
    for (const i of order) {
      if (heads.has(i) && !drawn.has(i)) throw new Error(`a transição do clipe ${i} não se desenhou`);
      if (drawn.has(i)) segs.push(`segh_${i}.mp4`);
      segs.push(`seg_${i}.mp4`);
      auds.push(`aud_${i}.wav`);
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
    // As camadas do estúdio, por cima dos textos e stickers de antes e por baixo da assinatura.
    if (layersJob) {
      for (const l of await layersJob) overlays.push({ file: l.file, x: l.x, y: l.y, start: null, end: null, frames: { k0: l.k0, k1: l.k1, anim: l.anim } });
    }
    const sign = await this.overlayPng(signatureSvg(OUT_W, OUT_H, spec.username, '', true, spec.seal), join(tmp, 'sign.png'));
    if (sign) overlays.push({ file: 'sign.png', ...sign, start: null, end: null });
    const items: TextItem[] = spec.texts
      .filter((t) => t.start < T - 0.1)
      .map((t) => ({ ...t, end: Math.min(T, t.end ?? t.start + 4) }));
    const tx = textFilters(items, OUT_W, OUT_H, 'font.ttf', (i, j) => `text_${i}_${j}.txt`);
    for (const f of tx.files) await writeFile(join(tmp, f.name), f.text, 'utf8');

    // O som gerado aqui com o mesmo desenho do estúdio (compose/audio.ts): os efeitos sonoros numa faixa e, com o Estádio,
    // a resposta ao impulso do reverb.
    const cues = (mix?.sfx ?? []).filter((c) => c.at < T);
    if (cues.length) await writeFile(join(tmp, 'sfx.wav'), encodeWav([renderSfxTrack(cues, T, RATE)], RATE));
    const needIr = mix && (mix.originalFx === 'estadio' || (voice && mix.voice?.fx === 'estadio'));
    if (needIr) await writeFile(join(tmp, 'ir.wav'), encodeWav(reverbImpulse(RATE), RATE));

    // 5. 2.º passo: juntar, dueto, texto, stickers, assinatura e o som; o MP4 final.
    const fin = finalArgs({
      seconds: T, videoList: 'videos.txt', audioList: 'audios.txt',
      music: music ? { file: music, volume: spec.musicVolume, startS: mix?.musicStart ?? 0, fadeIn: mix?.fadeIn ?? 0, fadeOut: mix?.fadeOut ?? 0 } : null,
      duet: duet ? { file: duet.file, hasAudio: duet.hasAudio, volume: spec.musicVolume } : null,
      originalVolume: spec.originalVolume, originalFx: mix?.originalFx ?? 'normal',
      voice: voice && mix?.voice && mix.voice.start < T ? { file: voice.file, startS: mix.voice.start, volume: mix.voice.volume, fx: mix.voice.fx, duck: mix.ducking } : null,
      sfx: cues.length ? { file: 'sfx.wav', volume: mix!.sfxVolume } : null,
      irFile: needIr ? 'ir.wav' : null,
      texts: tx.filters, overlays, out: 'out.mp4', threads,
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

import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../../common/uuid7';
import { AppConfig, CONFIG } from '../../config';
import { PG_POOL } from '../../db/db.module';
import { curate, norm, type Curated } from './curation';
import { archive, ccmixter, freesound, jamendo, STYLE_ALIASES, type ExternalSource } from './sources';
import { coverTint } from './tint';
import { MUSIC_STYLES, STYLE_IDS, toPicker, type CatalogTrack, type LocalMusicSource, type MusicStyleId, type PickerTrack } from './track';

/** «Não gosto desta»: a faixa desce para todos quando pelo menos estas pessoas a marcam… */
export const DISLIKE_MIN_PEOPLE = 10;
/** …e são mais do que as vezes que foi usada nos últimos 30 dias. */
export const DISLIKE_RULE = `Desce para o fim das listas e sai de «Em alta» quando pelo menos ${DISLIKE_MIN_PEOPLE} pessoas marcam «Não gosto desta» e são mais do que as vezes que a faixa foi usada nos últimos 30 dias.`;

/** De quanto em quanto tempo a tarefa vai às fontes. */
const REFRESH_EVERY_MS = 12 * 3_600_000;
/** Faixas que as fontes deixaram de dar há mais do que isto saem das listas. */
const STALE_DAYS = 30;
/** Cache em memória do catálogo, das contagens e das marcas (o seletor abre muitas vezes). */
const SNAPSHOT_TTL_MS = 2 * 60_000;
/** Os usos desde sempre (o «1,2 mil usos») contam-se de 10 em 10 minutos: percorrem todas as publicações com música. */
const TOTALS_TTL_MS = 10 * 60_000;
/** Quantas capas se leem de cada vez (depois de cada atualização), e quantas ao mesmo tempo. */
const TINT_BATCH = 400;
const TINT_PARALLEL = 4;

interface Row { track: CatalogTrack; quality: number; signals: Record<string, number>; refreshedAt: string; stale: boolean; tint: [string, string] | null }
interface Snapshot {
  at: number;
  rows: Map<string, Row>;
  flags: Map<string, { status: 'hidden' | 'featured'; reason: string; at: string }>;
  uses7: Map<string, number>;
  uses30: Map<string, number>;
  usesTotal: Map<string, number>;
  dislikes: Map<string, number>;
  local: CatalogTrack[];
}
export interface RefreshResult { added: number; updated: number; total: number; sources: Record<string, { ok: boolean; tracks: number; error?: string }> }

/** A faixa no formato antigo, que fica guardada nos posts, stories e notas. */
export function storedTrack(t: CatalogTrack): Record<string, unknown> {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    url: t.previewUrl,
    landing: t.landing,
    license: t.license,
    licenseUrl: t.licenseUrl,
    durationMs: t.duration * 1000,
    cover: t.cover,
    source: t.source,
    ...(t.artistUsername ? { artistUsername: t.artistUsername } : {}),
  };
}

/**
 * O catálogo curado de música: a tarefa periódica (refresh) vai às fontes externas e guarda o que passa na curadoria; o seletor
 * lê daqui (Em alta, estilos, Artistas de Moçambique, Sons, pesquisa). Junta a fonte `local` da equipa dos artistas quando
 * ela se regista (registerLocalSource). Ver docs/musica.md.
 */
@Injectable()
export class MusicCatalogService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MusicCatalog');
  private localSource: LocalMusicSource | null = null;
  private snap: Snapshot | null = null;
  private loading: Promise<Snapshot> | null = null;
  private running: Promise<RefreshResult> | null = null;
  private tinting: Promise<number> | null = null;
  private totals: { at: number; map: Map<string, number> } | null = null;
  private lastRun: RefreshResult | null = null;
  private timer?: NodeJS.Timeout;
  /** Para os testes: as fontes externas podem ser trocadas (o fetch é simulado de qualquer forma). */
  fetcher: typeof fetch = (...a) => fetch(...a);

  constructor(@Inject(PG_POOL) private readonly pool: Pool, @Inject(CONFIG) private readonly config: AppConfig) {}

  onModuleInit() {
    if (this.config.NODE_ENV === 'test') return;
    const run = () => void this.refreshIfStale().catch((e) => this.log.warn(`falha a atualizar o catálogo de música: ${(e as Error).message}`));
    this.timer = setInterval(() => void this.refresh().catch((e) => this.log.warn(`falha a atualizar o catálogo de música: ${(e as Error).message}`)), REFRESH_EVERY_MS);
    this.timer.unref();
    setTimeout(run, 120_000).unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** A equipa dos artistas regista aqui a fonte `local` (no onModuleInit do serviço dela). */
  registerLocalSource(src: LocalMusicSource | null) {
    this.localSource = src;
    this.invalidate();
  }

  hasLocal() {
    return !!this.localSource;
  }

  /** Esquece a cache (depois de uma marca, de uma decisão do backoffice ou de uma atualização). */
  invalidate() {
    this.snap = null;
  }

  sources(): ExternalSource[] {
    const f: typeof fetch = (...a) => this.fetcher(...a);
    const out: ExternalSource[] = [ccmixter(f), archive(f)];
    if (this.config.JAMENDO_CLIENT_ID) out.push(jamendo(f, this.config.JAMENDO_CLIENT_ID));
    if (this.config.FREESOUND_TOKEN) out.push(freesound(f, this.config.FREESOUND_TOKEN));
    return out;
  }

  private async refreshIfStale() {
    const r = (await this.pool.query('SELECT max(refreshed_at) AS at FROM content.music_catalog')).rows[0];
    if (!r?.at || Date.now() - new Date(r.at as string).getTime() > REFRESH_EVERY_MS) await this.refresh();
  }

  /** Vai às fontes, faz a curadoria e guarda. Uma de cada vez. */
  refresh(): Promise<RefreshResult> {
    if (!this.running) this.running = this.doRefresh().finally(() => (this.running = null));
    return this.running;
  }

  private async doRefresh(): Promise<RefreshResult> {
    const found = new Map<string, Curated>();
    const sources: RefreshResult['sources'] = {};
    const keep = (c: Curated | null) => {
      if (!c) return false;
      const had = found.get(c.track.id);
      if (had) {
        had.track.styles = [...new Set([...had.track.styles, ...c.track.styles])];
        return false;
      }
      found.set(c.track.id, c);
      return true;
    };
    for (const src of this.sources()) {
      let tracks = 0;
      const errors: string[] = [];
      let tries = 0;
      for (const style of STYLE_IDS) {
        tries++;
        try {
          for (const c of await src.search(style)) if (keep(curate(c, [style]))) tracks++;
        } catch (e) {
          errors.push((e as Error).message);
        }
      }
      if (src.sounds) {
        tries++;
        try {
          for (const c of await src.sounds()) if (keep(curate(c, []))) tracks++;
        } catch (e) {
          errors.push((e as Error).message);
        }
      }
      const ok = errors.length < tries;
      sources[src.id] = { ok, tracks, ...(errors.length ? { error: errors[0].slice(0, 200) } : {}) };
      if (errors.length) this.log.warn(`música: ${src.id} falhou ${errors.length}× (${errors[0]})`);
    }
    let added = 0;
    let updated = 0;
    for (const c of found.values()) {
      const r = await this.pool.query(
        `INSERT INTO content.music_catalog (id, source, kind, track, styles, quality, signals) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET track = EXCLUDED.track, kind = EXCLUDED.kind, styles = EXCLUDED.styles, quality = EXCLUDED.quality, signals = EXCLUDED.signals, refreshed_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [c.track.id, c.track.source, c.track.kind, JSON.stringify(c.track), c.track.styles, c.quality, JSON.stringify(c.signals)],
      );
      if (r.rows[0]?.inserted) added++;
      else updated++;
    }
    const total = (await this.pool.query(`SELECT count(*)::int AS n FROM content.music_catalog WHERE refreshed_at > now() - interval '${STALE_DAYS} days'`)).rows[0].n as number;
    this.lastRun = { added, updated, total, sources };
    this.invalidate();
    this.log.log(`catálogo de música: ${added} novas, ${updated} atualizadas, ${total} no total`);
    // As cores das capas novas (para o destaque no seletor) leem-se depois, sem atrasar a resposta.
    if (this.config.NODE_ENV !== 'test') void this.tintCovers().catch((e) => this.log.warn(`falha a ler as cores das capas: ${(e as Error).message}`));
    return this.lastRun;
  }

  /**
   * Lê as cores das capas que ainda não as têm (ou cuja capa mudou), com sharp, e guarda-as em `cover_tint`. Uma volta de cada
   * vez; devolve quantas leu. Uma capa que falha fica marcada sem cores (não se tenta outra vez até a capa mudar).
   */
  tintCovers(): Promise<number> {
    if (!this.tinting) this.tinting = this.doTint().finally(() => (this.tinting = null));
    return this.tinting;
  }

  private async doTint(): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT id, track->>'cover' AS cover FROM content.music_catalog
        WHERE kind = 'music' AND track->>'cover' IS NOT NULL AND (cover_tint IS NULL OR cover_tint->>'cover' IS DISTINCT FROM track->>'cover')
        ORDER BY quality DESC LIMIT ${TINT_BATCH}`,
    );
    const f: typeof fetch = (...a) => this.fetcher(...a);
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < rows.length) {
        const r = rows[next++];
        const colors = await coverTint(r.cover as string, f).catch(() => null);
        await this.pool.query('UPDATE content.music_catalog SET cover_tint = $2 WHERE id = $1', [r.id, JSON.stringify({ cover: r.cover, colors })]);
        done++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(TINT_PARALLEL, rows.length) }, worker));
    if (done) this.invalidate();
    return done;
  }

  // ---------------------------------------------------------------- leitura

  private snapshot(): Promise<Snapshot> {
    if (this.snap && Date.now() - this.snap.at < SNAPSHOT_TTL_MS) return Promise.resolve(this.snap);
    if (!this.loading) {
      this.loading = this.load()
        .then((s) => (this.snap = s))
        .finally(() => (this.loading = null));
    }
    return this.loading;
  }

  private async load(): Promise<Snapshot> {
    const [rows, flags, uses, dislikes, local] = await Promise.all([
      this.pool.query(
        `SELECT track, quality, signals, refreshed_at, refreshed_at <= now() - interval '${STALE_DAYS} days' AS stale,
                CASE WHEN cover_tint->>'cover' = track->>'cover' THEN cover_tint->'colors' END AS tint
           FROM content.music_catalog`,
      ),
      this.pool.query('SELECT track_id, status, reason, updated_at FROM content.music_flags'),
      this.pool.query(
        `WITH used AS (
           SELECT p.music->>'id' AS id, p.created_at FROM content.posts p
            WHERE p.music IS NOT NULL AND p.removed_at IS NULL AND p.music->>'kind' IS DISTINCT FROM 'clip' AND p.created_at > now() - interval '30 days'
           UNION ALL
           SELECT s.music->>'id', s.created_at FROM content.stories s
            WHERE s.music IS NOT NULL AND s.music->>'kind' IS DISTINCT FROM 'clip' AND s.created_at > now() - interval '30 days')
         SELECT id, count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS uses7, count(*)::int AS uses30 FROM used WHERE id IS NOT NULL GROUP BY id`,
      ),
      this.pool.query('SELECT track_id, count(*)::int AS n FROM content.music_dislikes GROUP BY track_id'),
      this.localList({ limit: 300 }),
    ]);
    const totals = await this.usesTotal();
    return {
      at: Date.now(),
      rows: new Map(rows.rows.map((r) => [(r.track as CatalogTrack).id, { track: r.track as CatalogTrack, quality: Number(r.quality), signals: r.signals as Record<string, number>, refreshedAt: new Date(r.refreshed_at as string).toISOString(), stale: !!r.stale, tint: Array.isArray(r.tint) && r.tint.length === 2 ? (r.tint as [string, string]) : null }])),
      flags: new Map(flags.rows.map((r) => [r.track_id as string, { status: r.status as 'hidden' | 'featured', reason: r.reason as string, at: new Date(r.updated_at as string).toISOString() }])),
      uses7: new Map(uses.rows.map((r) => [r.id as string, r.uses7 as number])),
      uses30: new Map(uses.rows.map((r) => [r.id as string, r.uses30 as number])),
      usesTotal: totals,
      dislikes: new Map(dislikes.rows.map((r) => [r.track_id as string, r.n as number])),
      local,
    };
  }

  /** Vezes que cada faixa foi usada em mimos e tchekas desde sempre (sem clipes próprios). Só números. */
  private async usesTotal(): Promise<Map<string, number>> {
    if (this.totals && Date.now() - this.totals.at < TOTALS_TTL_MS) return this.totals.map;
    const { rows } = await this.pool.query(
      `SELECT id, count(*)::int AS n FROM (
         SELECT p.music->>'id' AS id FROM content.posts p WHERE p.music IS NOT NULL AND p.removed_at IS NULL AND p.music->>'kind' IS DISTINCT FROM 'clip'
         UNION ALL
         SELECT s.music->>'id' FROM content.stories s WHERE s.music IS NOT NULL AND s.music->>'kind' IS DISTINCT FROM 'clip') u
        WHERE id IS NOT NULL GROUP BY id`,
    );
    this.totals = { at: Date.now(), map: new Map(rows.map((r) => [r.id as string, r.n as number])) };
    return this.totals.map;
  }

  private async localList(opts: { style?: MusicStyleId; q?: string; limit: number }): Promise<CatalogTrack[]> {
    if (!this.localSource) return [];
    try {
      return (await this.localSource.list(opts)).filter((t) => t && t.source === 'local' && typeof t.id === 'string' && t.id.startsWith('local:'));
    } catch (e) {
      this.log.warn(`fonte local falhou: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * O que não se mostra a esta pessoa: as que marcou com «Não gosto desta» e, para quem tem menos de 18 anos (ou não deu a data
   * de nascimento), as faixas explícitas da fonte local.
   */
  private async myDislikes(userId: string): Promise<Set<string>> {
    const [{ rows }, adult] = await Promise.all([
      this.pool.query('SELECT track_id FROM content.music_dislikes WHERE user_id = $1', [userId]),
      this.localSource
        ? this.pool.query(`SELECT 1 FROM identity.users WHERE id = $1 AND birth_date <= (current_date - interval '18 years')`, [userId]).then((r) => !!r.rowCount)
        : Promise.resolve(true),
    ]);
    const out = new Set(rows.map((r) => r.track_id as string));
    if (!adult) for (const t of (await this.snapshot()).local) if (t.explicit) out.add(t.id);
    return out;
  }

  private downranked(s: Snapshot, id: string) {
    const n = s.dislikes.get(id) ?? 0;
    return n >= DISLIKE_MIN_PEOPLE && n > (s.uses30.get(id) ?? 0);
  }

  /** Todas as faixas que se podem mostrar: catálogo atual mais a fonte local, sem as escondidas. */
  private visible(s: Snapshot): CatalogTrack[] {
    const out: CatalogTrack[] = [];
    for (const r of s.rows.values()) if (!r.stale && s.flags.get(r.track.id)?.status !== 'hidden') out.push(r.track);
    for (const t of s.local) if (s.flags.get(t.id)?.status !== 'hidden') out.push(t);
    return out;
  }

  /** A ordem nas listas: destacadas primeiro, rejeitadas por muitos no fim; no meio, qualidade da fonte e uso no Txillapp. */
  private rank(s: Snapshot, t: CatalogTrack) {
    const featured = s.flags.get(t.id)?.status === 'featured' ? 10 : 0;
    const quality = t.source === 'local' ? 0.6 : (s.rows.get(t.id)?.quality ?? 0);
    const uses = Math.min(1, Math.log10(1 + (s.uses7.get(t.id) ?? 0)) / 2);
    return featured + quality + uses - (this.downranked(s, t.id) ? 5 : 0);
  }

  private sorted(s: Snapshot, list: CatalogTrack[]) {
    return list.map((t) => ({ t, r: this.rank(s, t) })).sort((a, b) => b.r - a.r).map((x) => x.t);
  }

  private pick(s: Snapshot, t: CatalogTrack, withUses = false): PickerTrack {
    // Os totais contam-se mais devagar do que os 30 dias: nunca menos do que esses.
    const usesTotal = Math.max(s.usesTotal.get(t.id) ?? 0, s.uses30.get(t.id) ?? 0);
    return toPicker(t, { ...(withUses ? { uses: s.uses7.get(t.id) ?? 0 } : {}), featured: s.flags.get(t.id)?.status === 'featured', usesTotal, coverColors: s.rows.get(t.id)?.tint ?? null });
  }

  /**
   * As faixas guardadas (favoritas) com o que o catálogo sabe delas agora: estilos, usos, cores da capa e, nas locais, o endereço
   * do trecho outra vez válido. As que o catálogo já não mostra ficam como foram guardadas.
   */
  async enrich<T extends { id: string }>(list: T[]): Promise<(T | PickerTrack)[]> {
    if (!list.length) return list;
    const s = await this.snapshot();
    const byId = new Map(this.visible(s).map((t) => [t.id, t]));
    return list.map((t) => {
      const c = byId.get(t.id);
      if (c) return this.pick(s, c);
      return t.id.startsWith('local:') ? (this.resolveLocal(t as unknown as Record<string, unknown>) as unknown as T) : t;
    });
  }

  /** «Em alta no Txillapp»: destacadas, depois as mais usadas nos últimos 7 dias; completa com as de melhor qualidade. */
  async trending(userId: string, limit = 20): Promise<PickerTrack[]> {
    const [s, mine] = await Promise.all([this.snapshot(), this.myDislikes(userId)]);
    return this.trendingFrom(s, mine, limit);
  }

  private trendingFrom(s: Snapshot, mine: Set<string>, limit: number): PickerTrack[] {
    const pool = this.visible(s).filter((t) => t.kind === 'music' && !mine.has(t.id) && !this.downranked(s, t.id));
    const featured = (t: CatalogTrack) => (s.flags.get(t.id)?.status === 'featured' ? 1 : 0);
    const quality = (t: CatalogTrack) => (t.source === 'local' ? 0.6 : (s.rows.get(t.id)?.quality ?? 0));
    pool.sort((a, b) => featured(b) - featured(a) || (s.uses7.get(b.id) ?? 0) - (s.uses7.get(a.id) ?? 0) || quality(b) - quality(a));
    return pool.slice(0, limit).map((t) => this.pick(s, t, true));
  }

  /** O que o seletor mostra ao abrir. */
  async home(userId: string) {
    const [s, mine] = await Promise.all([this.snapshot(), this.myDislikes(userId)]);
    const vis = this.visible(s).filter((t) => !mine.has(t.id));
    const count = new Map<string, number>();
    for (const t of vis) if (t.kind === 'music') for (const st of t.styles) count.set(st, (count.get(st) ?? 0) + 1);
    const local = this.localSource ? this.sorted(s, vis.filter((t) => t.source === 'local')).slice(0, 30).map((t) => this.pick(s, t)) : [];
    return {
      styles: MUSIC_STYLES.filter((st) => count.get(st.id)).map((st) => ({ id: st.id, label: st.label, kind: st.kind, count: count.get(st.id)! })),
      trending: this.trendingFrom(s, mine, 20),
      local: local.length ? local : null,
      sounds: vis.some((t) => t.kind === 'sound'),
      recent: await this.recent(userId, s, mine),
    };
  }

  /** As faixas do catálogo que eu usei há pouco (sem clipes, sem as que já não existem). */
  private async recent(userId: string, s: Snapshot, mine: Set<string>): Promise<PickerTrack[]> {
    const { rows } = await this.pool.query(
      `SELECT id FROM (
         SELECT p.music->>'id' AS id, p.created_at FROM content.posts p WHERE p.author_id = $1 AND p.music IS NOT NULL AND p.removed_at IS NULL AND p.created_at > now() - interval '30 days'
         UNION ALL
         SELECT s.music->>'id', s.created_at FROM content.stories s WHERE s.author_id = $1 AND s.music IS NOT NULL AND s.created_at > now() - interval '30 days') u
        WHERE id IS NOT NULL GROUP BY id ORDER BY max(created_at) DESC LIMIT 20`,
      [userId],
    );
    const byId = new Map(this.visible(s).map((t) => [t.id, t]));
    return rows.map((r) => byId.get(r.id as string)).filter((t): t is CatalogTrack => !!t && !mine.has(t.id)).slice(0, 8).map((t) => this.pick(s, t));
  }

  async style(userId: string, style: MusicStyleId, limit = 40): Promise<PickerTrack[]> {
    const [s, mine] = await Promise.all([this.snapshot(), this.myDislikes(userId)]);
    const list = this.visible(s).filter((t) => t.kind === 'music' && t.styles.includes(style) && !mine.has(t.id));
    return this.sorted(s, list).slice(0, limit).map((t) => this.pick(s, t));
  }

  async local(userId: string, style?: MusicStyleId, opts: { q?: string; artist?: string } = {}): Promise<PickerTrack[]> {
    if (!this.localSource) return [];
    const [s, mine] = await Promise.all([this.snapshot(), this.myDislikes(userId)]);
    const q = norm((opts.q ?? '').trim());
    const list = this.visible(s).filter(
      (t) =>
        t.source === 'local' &&
        (!style || t.styles.includes(style)) &&
        (!opts.artist || t.artistUsername === opts.artist) &&
        (q.length < 2 || norm(`${t.title} ${t.artist}`).includes(q)) &&
        !mine.has(t.id),
    );
    return this.sorted(s, list).slice(0, 60).map((t) => this.pick(s, t));
  }

  async sounds(userId: string): Promise<PickerTrack[]> {
    const [s, mine] = await Promise.all([this.snapshot(), this.myDislikes(userId)]);
    return this.sorted(s, this.visible(s).filter((t) => t.kind === 'sound' && !mine.has(t.id))).slice(0, 60).map((t) => this.pick(s, t));
  }

  /** Pesquisa no catálogo e na fonte local: título, artista ou estilo (também as palavras das pastilhas antigas: afro, dance…). */
  async search(userId: string, term: string, limit = 30): Promise<PickerTrack[]> {
    const q = norm(term.trim().slice(0, 60));
    if (q.length < 2) throw new BadRequestException('Escreve pelo menos 2 letras');
    const [s, mine, localHits] = await Promise.all([this.snapshot(), this.myDislikes(userId), this.localList({ q: term.trim().slice(0, 60), limit: 30 })]);
    const styles = new Set<string>(
      MUSIC_STYLES.filter((st) => norm(st.label).includes(q) || st.id === q || STYLE_ALIASES[st.id].some((a) => norm(a) === q || (q.length >= 4 && norm(a).startsWith(q)))).map((st) => st.id),
    );
    const localIds = new Set(localHits.map((t) => t.id));
    const hits = this.visible(s).filter((t) => {
      if (mine.has(t.id)) return false;
      if (localIds.has(t.id)) return true;
      if (norm(`${t.title} ${t.artist} ${t.artistUsername ?? ''}`).includes(q)) return true;
      return t.kind === 'music' && t.styles.some((st) => styles.has(st));
    });
    return this.sorted(s, hits).slice(0, limit).map((t) => this.pick(s, t));
  }

  // ---------------------------------------------------------------- «Não gosto desta»

  async dislike(userId: string, trackId: string) {
    const n = (await this.pool.query('SELECT count(*)::int AS n FROM content.music_dislikes WHERE user_id = $1', [userId])).rows[0].n as number;
    if (n >= 2000) throw new BadRequestException('Já marcaste demasiadas faixas');
    await this.pool.query('INSERT INTO content.music_dislikes (user_id, track_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, trackId]);
    this.invalidate();
    return { disliked: true as const };
  }

  async undislike(userId: string, trackId: string) {
    await this.pool.query('DELETE FROM content.music_dislikes WHERE user_id = $1 AND track_id = $2', [userId, trackId]);
    this.invalidate();
    return { disliked: false as const };
  }

  // ---------------------------------------------------------------- usar uma faixa

  /**
   * A versão do catálogo de uma faixa (para guardar num post, story, nota ou nas favoritas): `found` se o id é do catálogo ou da
   * fonte local; `unknown` se não é (faixas antigas do Openverse). Faixas escondidas, ou locais que já não existem, são recusadas.
   */
  async canonical(id: string): Promise<{ found: true; track: CatalogTrack } | { found: false }> {
    const flag = (await this.pool.query('SELECT status FROM content.music_flags WHERE track_id = $1', [id])).rows[0];
    if (flag?.status === 'hidden') throw new BadRequestException('Esta faixa já não está disponível');
    if (id.startsWith('local:')) {
      const t = this.localSource ? await this.localSource.get(id).catch(() => null) : null;
      if (!t || t.id !== id || t.source !== 'local') throw new BadRequestException('Esta faixa já não está disponível');
      return { found: true, track: t };
    }
    const r = (await this.pool.query('SELECT track FROM content.music_catalog WHERE id = $1', [id])).rows[0];
    return r ? { found: true, track: r.track as CatalogTrack } : { found: false };
  }

  /**
   * Usar uma faixa da fonte local num mimo ou numa tcheka: recusa as escondidas no backoffice e passa à fonte, que confirma que
   * a faixa está disponível para esta pessoa, conta o uso e devolve o que fica guardado (ver LocalMusicSource.prepareUse).
   */
  async prepareLocalUse(userId: string, id: string, surface: 'post' | 'story'): Promise<Record<string, unknown>> {
    const fullId = id.startsWith('local:') ? id : `local:${id}`;
    const flag = (await this.pool.query('SELECT status FROM content.music_flags WHERE track_id = $1', [fullId])).rows[0];
    if (flag?.status === 'hidden' || !this.localSource?.prepareUse) throw new BadRequestException('Esta faixa já não está disponível');
    const out = await this.localSource.prepareUse(userId, fullId, surface);
    this.invalidate(); // «Em alta» conta já este uso
    return out;
  }

  /** Uma faixa local guardada numa publicação, com o endereço do áudio outra vez válido (se a fonte souber fazê-lo). */
  resolveLocal(stored: Record<string, unknown>): Record<string, unknown> {
    return this.localSource?.resolveStored ? this.localSource.resolveStored(stored) : stored;
  }

  // ---------------------------------------------------------------- backoffice

  async adminList(q: { sort: 'uses' | 'dislikes' | 'quality' | 'recent'; status: 'all' | 'featured' | 'hidden' | 'downranked'; style?: MusicStyleId; q?: string }) {
    this.invalidate();
    const s = await this.snapshot();
    const all: { t: CatalogTrack; row?: Row }[] = [...[...s.rows.values()].filter((r) => !r.stale || s.flags.has(r.track.id)).map((r) => ({ t: r.track, row: r })), ...s.local.map((t) => ({ t }))];
    const term = q.q ? norm(q.q) : '';
    const items = all
      .filter(({ t }) => {
        const flag = s.flags.get(t.id)?.status;
        if (q.status === 'featured' && flag !== 'featured') return false;
        if (q.status === 'hidden' && flag !== 'hidden') return false;
        if (q.status === 'downranked' && !this.downranked(s, t.id)) return false;
        if (q.style && !t.styles.includes(q.style)) return false;
        if (term && !norm(`${t.title} ${t.artist} ${t.artistUsername ?? ''} ${t.id}`).includes(term)) return false;
        return true;
      })
      .map(({ t, row }) => {
        const flag = s.flags.get(t.id);
        return {
          ...t,
          status: (flag?.status ?? 'active') as 'active' | 'hidden' | 'featured',
          statusReason: flag?.reason ?? null,
          statusAt: flag?.at ?? null,
          quality: row?.quality ?? 0,
          signals: row?.signals ?? {},
          refreshedAt: row?.refreshedAt ?? null,
          uses7d: s.uses7.get(t.id) ?? 0,
          uses30d: s.uses30.get(t.id) ?? 0,
          dislikes: s.dislikes.get(t.id) ?? 0,
          downranked: this.downranked(s, t.id),
        };
      });
    const by = {
      uses: (a: (typeof items)[number], b: (typeof items)[number]) => b.uses7d - a.uses7d || b.uses30d - a.uses30d || b.quality - a.quality,
      dislikes: (a: (typeof items)[number], b: (typeof items)[number]) => b.dislikes - a.dislikes || b.uses7d - a.uses7d,
      quality: (a: (typeof items)[number], b: (typeof items)[number]) => b.quality - a.quality,
      recent: (a: (typeof items)[number], b: (typeof items)[number]) => (b.refreshedAt ?? '').localeCompare(a.refreshedAt ?? ''),
    }[q.sort];
    items.sort(by);
    const refreshedAt = (await this.pool.query('SELECT max(refreshed_at) AS at FROM content.music_catalog')).rows[0]?.at as string | null;
    const counts = new Map<string, number>();
    for (const { t } of all) counts.set(t.source, (counts.get(t.source) ?? 0) + 1);
    const ext = this.sources();
    const sources = [
      ...(['ccmixter', 'archive', 'jamendo', 'freesound'] as const).map((id) => {
        const src = ext.find((x) => x.id === id);
        const last = this.lastRun?.sources[id];
        return {
          id,
          enabled: !!src,
          tracks: counts.get(id) ?? 0,
          lastError: last?.error ?? null,
          note: src?.note ?? (id === 'jamendo' ? 'Desligada: falta JAMENDO_CLIENT_ID (e a licença comercial da Jamendo).' : 'Desligada: falta FREESOUND_TOKEN (e o acordo comercial com o Freesound).'),
        };
      }),
      { id: 'local', enabled: this.hasLocal(), tracks: s.local.length, lastError: null, note: this.hasLocal() ? 'Artistas de Moçambique (carregam as músicas no Txillapp).' : 'Ainda não existe: a secção «Artistas de Moçambique» não aparece na app.' },
    ];
    return {
      threshold: { minPeople: DISLIKE_MIN_PEOPLE, rule: DISLIKE_RULE },
      refreshedAt: refreshedAt ? new Date(refreshedAt).toISOString() : null,
      total: items.length,
      styles: MUSIC_STYLES.map((st) => ({ id: st.id, label: st.label })),
      sources,
      items: items.slice(0, 200),
    };
  }

  /** Esconder, destacar ou repor uma faixa (de qualquer fonte). Fica na auditoria. */
  async setStatus(actor: string, id: string, status: 'active' | 'hidden' | 'featured', reason: string) {
    const s = await this.snapshot();
    let t: CatalogTrack | undefined = s.rows.get(id)?.track ?? s.local.find((x) => x.id === id);
    if (!t) {
      const r = (await this.pool.query('SELECT track FROM content.music_catalog WHERE id = $1', [id])).rows[0];
      t = (r?.track as CatalogTrack | undefined) ?? (id.startsWith('local:') && this.localSource ? ((await this.localSource.get(id).catch(() => null)) ?? undefined) : undefined);
    }
    if (!t) throw new NotFoundException('Faixa não encontrada');
    const before = ((await this.pool.query('SELECT status FROM content.music_flags WHERE track_id = $1', [id])).rows[0]?.status as string | undefined) ?? 'active';
    if (status === 'active') await this.pool.query('DELETE FROM content.music_flags WHERE track_id = $1', [id]);
    else
      await this.pool.query(
        `INSERT INTO content.music_flags (track_id, status, reason, staff_id) VALUES ($1, $2, $3, $4)
         ON CONFLICT (track_id) DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason, staff_id = EXCLUDED.staff_id, updated_at = now()`,
        [id, status, reason, actor],
      );
    const action = status === 'hidden' ? 'music.hide' : status === 'featured' ? 'music.feature' : 'music.restore';
    await this.audit(actor, action, `music:${id}`, { title: t.title, artist: t.artist, source: t.source, reason, from: before, to: status });
    this.invalidate();
  }

  async adminRefresh(actor: string, reason?: string): Promise<RefreshResult> {
    const r = await this.refresh();
    await this.audit(actor, 'music.refresh', 'music:catalog', { ...(reason ? { reason } : {}), added: r.added, updated: r.updated, total: r.total });
    return r;
  }

  private async audit(actor: string, action: string, target: string, metadata: Record<string, unknown>) {
    await this.pool.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), actor, action, target, metadata]);
  }
}

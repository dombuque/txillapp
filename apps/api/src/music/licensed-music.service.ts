import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Scheduler } from '../realtime/scheduler';
import { Pool } from 'pg';
import { z } from 'zod';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { FakeLicensedProvider } from './providers/fake-licensed.provider';
import { MusicProvider, MusicTrack, UsageEvent, UsageRow } from './providers/music-provider';

/** A faixa licenciada que uma publicação leva: só a referência; o resto vem do fornecedor (nunca confiamos na app). */
export const licensedRefSchema = z.object({
  kind: z.literal('licensed'),
  source: z.string().regex(/^[a-z0-9_-]{1,30}$/),
  id: z.string().min(1).max(80),
  /** O que a app mostrou (só passa no filtro de palavras; guarda-se o título do fornecedor). */
  title: z.string().max(120).optional(),
});
export type LicensedRef = z.infer<typeof licensedRefSchema>;

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Música licenciada (comercial). Junta um ou mais fornecedores (MusicProvider) e trata, igual para todos, o que os contratos
 * exigem: só nos países do contrato, cada escuta e cada publicação contadas (agregadas por dia, faixa e país), relatórios
 * por dia fechado e remoções aplicadas em todo o lado. Desligada (MUSIC_LICENSED_ENABLED=false), fica invisível.
 */
@Injectable()
export class LicensedMusicService implements OnModuleInit {
  private readonly log = new Logger('LicensedMusic');
  private readonly providers = new Map<string, MusicProvider>();
  private readonly territories: Set<string>;
  readonly clipSeconds: number;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scheduler: Scheduler,
  ) {
    this.territories = new Set(config.MUSIC_LICENSED_TERRITORIES.split(',').map((c) => c.trim().toUpperCase()));
    this.clipSeconds = config.MUSIC_LICENSED_CLIP_SECONDS;
    if (config.MUSIC_LICENSED_ENABLED) {
      const p = this.createProvider();
      if (p) this.providers.set(p.source, p);
      else this.log.warn('MUSIC_LICENSED_ENABLED=true mas sem adaptador (MUSIC_LICENSED_DRIVER=none): a música licenciada fica desligada');
    }
  }

  /** Um adaptador por fornecedor. Para ligar um real: escrever providers/<nome>.provider.ts e acrescentá-lo aqui. */
  private createProvider(): MusicProvider | null {
    switch (this.config.MUSIC_LICENSED_DRIVER) {
      case 'fake':
        return new FakeLicensedProvider();
      default:
        return null;
    }
  }

  onModuleInit() {
    if (!this.providers.size) return;
    // De 6 em 6 horas: ler as remoções do fornecedor e entregar os dias fechados que faltam.
    this.scheduler.every('music.licensed', 6 * 3600_000, () => this.housekeeping());
  }

  private async housekeeping() {
    for (const source of this.providers.keys()) {
      await this.syncTakedowns(source).catch((e) => this.log.warn(`remoções de ${source}: ${(e as Error).message}`));
      await this.report(source).catch((e) => this.log.warn(`relatório de ${source}: ${(e as Error).message}`));
    }
  }

  /** O adaptador (os testes usam-no para simular o fornecedor). */
  provider(source: string): MusicProvider | undefined {
    return this.providers.get(source);
  }

  /** Para o resolve das publicações: com o fornecedor desligado, a faixa não aparece. */
  isOn(source: string) {
    return this.providers.has(source);
  }

  private async countryOf(userId: string): Promise<string | null> {
    const r = await this.pool.query('SELECT country FROM identity.users WHERE id = $1', [userId]);
    const c = (r.rows[0]?.country as string | null)?.trim().toUpperCase();
    return c && /^[A-Z]{2}$/.test(c) ? c : null;
  }

  /** O fornecedor e o país, se esta pessoa pode usar música licenciada (ligada e num país do contrato). */
  private async access(userId: string): Promise<{ p: MusicProvider; country: string } | null> {
    const p = this.providers.values().next().value as MusicProvider | undefined;
    if (!p) return null;
    const country = await this.countryOf(userId);
    if (!country || !this.territories.has(country)) return null;
    return { p, country };
  }

  private async mustAccess(userId: string) {
    const a = await this.access(userId);
    if (!a) throw new NotFoundException();
    return a;
  }

  private async removedIds(source: string, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const r = await this.pool.query('SELECT track_id FROM content.music_takedowns WHERE source = $1 AND track_id = ANY($2::text[])', [source, ids]);
    return new Set(r.rows.map((x) => x.track_id as string));
  }

  /** Tira as faixas retiradas e o endereço do excerto (cada escuta pede-se à parte, para ser contada). */
  private async clean(source: string, items: MusicTrack[]): Promise<MusicTrack[]> {
    const gone = await this.removedIds(source, items.map((t) => t.id));
    return items.filter((t) => !gone.has(t.id)).map((t) => ({ ...t, source, license: 'licensed', previewUrl: null }));
  }

  async status(userId: string) {
    const a = await this.access(userId);
    return a ? { enabled: true as const, source: a.p.source, clipSeconds: this.clipSeconds } : { enabled: false as const };
  }

  async search(userId: string, term: string) {
    const q = term.trim().slice(0, 60);
    if (q.length < 2) throw new BadRequestException('Escreve pelo menos 2 letras');
    const { p, country } = await this.mustAccess(userId);
    return this.clean(p.source, await p.search(q, { country, limit: 20 }));
  }

  async trending(userId: string) {
    const { p, country } = await this.mustAccess(userId);
    return this.clean(p.source, await p.trending({ country, limit: 20 }));
  }

  async track(userId: string, id: string) {
    const { p, country } = await this.mustAccess(userId);
    const t = await p.track(id, { country });
    const [out] = t ? await this.clean(p.source, [t]) : [];
    if (!out) throw new NotFoundException('Esta música não está disponível');
    return out;
  }

  /** O excerto para ouvir (no seletor: 'preview'; numa publicação: 'play'). Cada pedido conta. */
  async listen(userId: string, id: string, event: 'preview' | 'play') {
    const { p, country } = await this.mustAccess(userId);
    if ((await this.removedIds(p.source, [id])).size) throw new NotFoundException('Esta música não está disponível');
    const u = await p.previewUrl(id, { country, maxSeconds: this.clipSeconds });
    if (!u) throw new NotFoundException('Esta música não está disponível');
    await this.record(p.source, id, country, event);
    return { ...u, clipSeconds: this.clipSeconds };
  }

  /** Antes de guardar uma publicação: a faixa tem de existir, estar licenciada no meu país e não ter sido retirada. */
  async prepare(userId: string, ref: LicensedRef): Promise<Record<string, unknown>> {
    const a = await this.access(userId);
    if (!a || a.p.source !== ref.source) throw new BadRequestException('Esta música não está disponível');
    const t = await a.p.track(ref.id, { country: a.country });
    if (!t || (await this.removedIds(a.p.source, [ref.id])).size) throw new BadRequestException('Esta música não está disponível');
    await this.record(a.p.source, t.id, a.country, 'create');
    return { kind: 'licensed', source: a.p.source, id: t.id, title: t.title, artist: t.artist, duration: t.duration, cover: t.cover, license: 'licensed', styles: t.styles, clipSeconds: this.clipSeconds };
  }

  /** Conta um uso (agregado: dia, faixa, país, tipo). Serve qualquer catálogo, não só o licenciado. */
  async record(source: string, trackId: string, country: string | null, event: UsageEvent) {
    await this.pool.query(
      `INSERT INTO content.music_usage_daily (day, source, track_id, country, event, count) VALUES ((now() AT TIME ZONE 'UTC')::date, $1, $2, $3, $4, 1)
       ON CONFLICT (source, day, track_id, country, event) DO UPDATE SET count = content.music_usage_daily.count + 1`,
      [source, trackId.slice(0, 80), country && /^[A-Z]{2}$/.test(country) ? country : 'ZZ', event],
    );
  }

  /**
   * Entrega ao fornecedor o uso dos dias fechados (até ontem, UTC) que ainda não foram entregues, dia a dia.
   * Voltar a correr não duplica: cada dia entregue fica marcado.
   */
  async report(source: string) {
    const p = this.providers.get(source);
    if (!p) return { enabled: false as const, days: 0, rows: 0, accepted: 0 };
    const days = (await this.pool.query(
      `SELECT DISTINCT u.day::text AS day FROM content.music_usage_daily u
        WHERE u.source = $1 AND u.day < (now() AT TIME ZONE 'UTC')::date AND u.day >= (now() AT TIME ZONE 'UTC')::date - 90
          AND NOT EXISTS (SELECT 1 FROM content.music_usage_reports r WHERE r.source = u.source AND r.day = u.day)
        ORDER BY 1`,
      [source],
    )).rows.map((r) => r.day as string);
    let rows = 0;
    let accepted = 0;
    for (const d of days) {
      const batch: UsageRow[] = (await this.pool.query(
        'SELECT track_id, country, event, count FROM content.music_usage_daily WHERE source = $1 AND day = $2 AND count > 0 ORDER BY track_id, country, event',
        [source, d],
      )).rows.map((r) => ({ day: d, trackId: r.track_id, country: r.country, event: r.event, count: r.count }));
      const res = await p.reportUsage(batch);
      await this.pool.query('INSERT INTO content.music_usage_reports (source, day, rows, accepted) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [source, d, batch.length, res.accepted]);
      rows += batch.length;
      accepted += res.accepted;
    }
    return { enabled: true as const, days: days.length, rows, accepted };
  }

  /** Lê os avisos de remoção do fornecedor desde a última vez e aplica-os. */
  async syncTakedowns(source: string) {
    const p = this.providers.get(source);
    if (!p) return { enabled: false as const, applied: 0 };
    const last = (await this.pool.query('SELECT takedowns_checked_at FROM content.music_provider_state WHERE source = $1', [source])).rows[0]?.takedowns_checked_at as Date | undefined;
    const checkedAt = new Date();
    const notices = await p.takedowns(last ?? new Date(0));
    let applied = 0;
    for (const n of notices) {
      const r = await this.takedown(source, n.trackId, n.reason, 'provider', null);
      if (r.new) applied++;
    }
    await this.pool.query(
      'INSERT INTO content.music_provider_state (source, takedowns_checked_at) VALUES ($1, $2) ON CONFLICT (source) DO UPDATE SET takedowns_checked_at = EXCLUDED.takedowns_checked_at',
      [source, checkedAt],
    );
    return { enabled: true as const, applied };
  }

  /**
   * Retira uma faixa: deixa de aparecer e sai das publicações, dos mimos e das notas que a levavam (o texto e as fotos
   * ficam; uma nota que era só música é apagada). Funciona mesmo com o fornecedor desligado.
   */
  async takedown(source: string, trackId: string, reason: string, origin: 'provider' | 'staff', actorId: string | null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        'INSERT INTO content.music_takedowns (source, track_id, reason, origin, actor_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
        [source, trackId, reason.trim().slice(0, 300) || 'Remoção', origin, actorId],
      );
      const match = `music->>'kind' = 'licensed' AND music->>'source' = $1 AND music->>'id' = $2`;
      const posts = await client.query(`UPDATE content.posts SET music = NULL WHERE music IS NOT NULL AND ${match}`, [source, trackId]);
      const stories = await client.query(`UPDATE content.stories SET music = NULL WHERE music IS NOT NULL AND ${match}`, [source, trackId]);
      const notesGone = await client.query(`DELETE FROM social.notes WHERE music IS NOT NULL AND ${match} AND char_length(body) = 0`, [source, trackId]);
      const notes = await client.query(`UPDATE social.notes SET music = NULL WHERE music IS NOT NULL AND ${match}`, [source, trackId]);
      const out = { new: (ins.rowCount ?? 0) > 0, posts: posts.rowCount ?? 0, stories: stories.rowCount ?? 0, notes: (notes.rowCount ?? 0) + (notesGone.rowCount ?? 0) };
      if (actorId) {
        await client.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
          uuidv7(), actorId, 'music.takedown', `${source}:${trackId}`, { reason, ...out },
        ]);
      }
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /** Para o backoffice: o uso por faixa e por país num intervalo de dias (até 92). */
  async usage(source: string, from: string, to: string) {
    const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
    const end = ok(to) ? to : day(new Date());
    const start = ok(from) ? from : day(new Date(Date.parse(end) - 29 * 86_400_000));
    if (start > end || Date.parse(end) - Date.parse(start) > 92 * 86_400_000) throw new BadRequestException('Intervalo inválido (até 92 dias)');
    const r = await this.pool.query(
      `SELECT track_id, country,
              sum(count) FILTER (WHERE event = 'preview')::int AS previews,
              sum(count) FILTER (WHERE event = 'play')::int AS plays,
              sum(count) FILTER (WHERE event = 'create')::int AS creates
         FROM content.music_usage_daily WHERE source = $1 AND day BETWEEN $2 AND $3
        GROUP BY track_id, country ORDER BY sum(count) DESC, track_id, country LIMIT 1000`,
      [source, start, end],
    );
    const items = r.rows.map((x) => ({ trackId: x.track_id, country: x.country, previews: x.previews ?? 0, plays: x.plays ?? 0, creates: x.creates ?? 0 }));
    return { source, from: start, to: end, enabled: this.isOn(source), items };
  }
}

import { ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Pool } from 'pg';
import { tierOf } from '../common/badge';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { referencedAmong } from '../media/media-refs';
import { MediaService } from '../media/media.service';
import { type SealTier } from '../media/signature';
import { NotificationsService } from '../notifications/notifications.service';
import { Scheduler } from '../realtime/scheduler';
import { StoriesService } from '../stories/stories.service';
import { RECAP_MAX, RECAP_MIN, RECAP_OUT, pickRecapPhotos, recapRange, renderZasRecap } from './zas-recap-card';

/** De quanto em quanto tempo corre a limpeza dos Zás (os que passaram das 24 h ou dos 7 dias) e dos resumos. */
export const ZAS_SWEEP_EVERY_MS = 30 * 60_000;
/** De quanto em quanto tempo se vê se é hora de fazer os resumos (domingo à noite) e quantos de cada vez. */
export const RECAP_EVERY_MS = 15 * 60_000;
export const RECAP_BATCH = 60;
/** A semana fecha ao domingo às 20h de Maputo; os resumos fazem-se daí até segunda às 6h (as voltas apanham toda a gente). */
export const RECAP_FROM_HOUR = 20;
export const RECAP_UNTIL_HOUR = 6;
/** Quantos dias o autor guarda os seus Zás (e quanto dura o resumo por publicar). */
export const ZAS_KEEP_DAYS = 7;

type Audience = 'all' | 'close_friends';

/** A hora de Maputo (UTC+2, sem hora de verão). */
const maputo = (d: Date) => new Date(d.getTime() + 2 * 3_600_000);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A semana do resumo que se faz agora, ou null fora da janela (domingo 20h → segunda 6h, em Maputo). A semana são os 7 dias
 * que acabam no domingo às 20h: «8 a 15 nov» é de domingo, 8, às 20h a domingo, 15, às 20h.
 */
export function recapWeek(now: Date): { from: string; to: string; start: Date; end: Date } | null {
  const m = maputo(now);
  const day = m.getUTCDay(), hour = m.getUTCHours();
  let sunday: Date;
  if (day === 0 && hour >= RECAP_FROM_HOUR) sunday = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate()));
  else if (day === 1 && hour < RECAP_UNTIL_HOUR) sunday = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate() - 1));
  else return null;
  // Domingo às 20h de Maputo = 18h UTC.
  const end = new Date(sunday.getTime() + (RECAP_FROM_HOUR - 2) * 3_600_000);
  const start = new Date(end.getTime() - 7 * 86_400_000);
  return { from: ymd(new Date(sunday.getTime() - 7 * 86_400_000)), to: ymd(sunday), start, end };
}

export interface RecapRow {
  id: string;
  media_id: string;
  week_start: string | Date;
  week_end: string | Date;
  instant_count: number;
  photo_count: number;
  created_at: string;
  expires_at: string;
  story_id: string | null;
  published_audience: Audience | null;
  published_at: string | null;
}

const dateOnly = (v: string | Date) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : String(v).slice(0, 10));

/**
 * O resumo semanal dos Zás (0164) e o que o rodeia: a definição «Guardar os meus Zás para o resumo semanal», o arquivo dos
 * meus Zás (os 7 dias em que os guardo, só para mim), a limpeza (às 24 h para os outros e, para mim, aos 7 dias: a linha e
 * o ficheiro), o resumo de domingo à noite (a imagem desenhada no servidor, zas-recap-card.ts) e publicá-lo num mimo.
 * À parte do InstantsService para não mexer no que lá está.
 */
@Injectable()
export class InstantsRecapService implements OnModuleInit {
  private readonly log = new Logger('ZasResumo');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly media: MediaService,
    private readonly notifications: NotificationsService,
    private readonly scheduler: Scheduler,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    // No worker (ou sem ROLE). Nos testes chamam-se à mão (sweep, run).
    this.scheduler.every('instants.sweep', ZAS_SWEEP_EVERY_MS, () => this.sweep(), { firstAfterMs: 2 * 60_000 });
    this.scheduler.every('instants.recap', RECAP_EVERY_MS, () => this.run(), { firstAfterMs: 3 * 60_000 });
  }

  /** O StoriesService (para publicar o resumo num mimo como qualquer outro), sem importar o módulo dos mimos. */
  private stories(): StoriesService {
    return this.moduleRef.get(StoriesService, { strict: false });
  }

  // ── A definição ────────────────────────────────────────────────────────────────────────────────────────────────

  async settings(me: string) {
    const r = (await this.pool.query('SELECT zas_keep FROM identity.users WHERE id = $1', [me])).rows[0];
    return { keepForRecap: r ? (r.zas_keep as boolean) : true };
  }

  /**
   * Ligar: os Zás ainda nas 24 h passam também a ficar 7 dias para mim. Desligar: deixo de guardar; os que já passaram das
   * 24 h e os resumos apagam-se logo (a linha e o ficheiro; um Zás com uma denúncia por decidir fica até a decisão, mas
   * eu já não o vejo). `removed`: quantos Zás guardados se apagaram.
   */
  async setSettings(me: string, keep: boolean) {
    await this.pool.query('UPDATE identity.users SET zas_keep = $2 WHERE id = $1', [me, keep]);
    if (keep) {
      await this.pool.query(`UPDATE social.instants SET keep_until = created_at + make_interval(days => $2) WHERE author_id = $1 AND expires_at > now() AND keep_until IS NULL`, [me, ZAS_KEEP_DAYS]);
      return { keepForRecap: true, removed: 0 };
    }
    await this.pool.query('UPDATE social.instants SET keep_until = NULL WHERE author_id = $1 AND keep_until IS NOT NULL', [me]);
    const gone = await this.pool.query(
      `DELETE FROM social.instants i WHERE i.author_id = $1 AND i.expires_at <= now()
          AND NOT EXISTS (SELECT 1 FROM social.reports r WHERE r.target_type = 'instant' AND r.target_id = i.id AND r.status = 'open')
        RETURNING i.media_id`,
      [me],
    );
    await this.dropMedia(gone.rows.map((r) => r.media_id as string));
    const recaps = await this.pool.query('DELETE FROM social.zas_recaps WHERE user_id = $1 RETURNING id, media_id', [me]);
    await this.afterRecapsGone(recaps.rows);
    return { keepForRecap: false, removed: gone.rowCount ?? 0 };
  }

  // ── O arquivo («Os meus Zás») ──────────────────────────────────────────────────────────────────────────────────

  /** Os meus Zás que ainda existem para mim: os das 24 h (`active`, os outros também os veem) e os guardados (só eu). */
  async archive(me: string) {
    const { rows } = await this.pool.query(
      `SELECT i.id, i.media_id, i.caption, i.caption_font, i.created_at, i.expires_at, i.keep_until, (i.expires_at > now()) AS active,
              (SELECT count(*)::int FROM social.instant_views v WHERE v.instant_id = i.id) AS views,
              coalesce((SELECT json_agg(json_build_object('reaction', x.reaction, 'count', x.n) ORDER BY x.n DESC) FROM (SELECT reaction, count(*)::int AS n FROM social.instant_reactions r WHERE r.instant_id = i.id GROUP BY reaction) x), '[]'::json) AS reactions
         FROM social.instants i JOIN content.media_assets m ON m.id = i.media_id
        WHERE i.author_id = $1 AND coalesce(i.keep_until, i.expires_at) > now() AND m.status = 'ready'
        ORDER BY i.created_at`,
      [me],
    );
    return rows.map((r) => ({
      id: r.id as string,
      url: this.media.chatUrl(r.media_id as string),
      caption: r.caption as string,
      captionFont: (r.caption_font as string | null) ?? null,
      at: r.created_at as string,
      expiresAt: r.expires_at as string,
      keepUntil: (r.keep_until as string | null) ?? null,
      active: r.active as boolean,
      views: r.views as number,
      reactions: r.reactions as { reaction: string; count: number }[],
    }));
  }

  // ── A limpeza ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** Ficheiros que deixaram de ser usados (um Zás ou um resumo que saiu): passam a apagados e a limpeza dos ficheiros tira-os. */
  private async dropMedia(ids: string[]) {
    if (!ids.length) return;
    const used = await referencedAmong(this.pool, ids);
    const free = ids.filter((id) => !used.has(id));
    if (free.length) await this.pool.query(`UPDATE content.media_assets SET status = 'deleted' WHERE id = ANY($1::uuid[]) AND status <> 'deleted'`, [free]);
  }

  /** Resumos que saíram: o ficheiro e o aviso na lista (que já não abria nada). */
  private async afterRecapsGone(rows: { id: string; media_id: string }[]) {
    if (!rows.length) return;
    await this.dropMedia(rows.map((r) => r.media_id));
    await this.pool.query(`DELETE FROM social.notifications WHERE kind = 'zas_recap' AND data->>'recapId' = ANY($1::text[])`, [rows.map((r) => r.id)]);
  }

  /**
   * Apaga mesmo os Zás que acabaram para toda a gente (às 24 h; para o autor que os guardava, aos 7 dias): a linha (com as
   * vistas e as reações) e o ficheiro, se não estiver em uso noutro sítio (uma resposta no chat leva a foto). Um Zás com uma
   * denúncia por decidir fica até à decisão. E os resumos com mais de 7 dias. Devolve quantos saíram.
   */
  async sweep(maxBatches = 20): Promise<{ instants: number; recaps: number }> {
    let instants = 0;
    for (let b = 0; b < maxBatches; b++) {
      const { rows } = await this.pool.query(
        `DELETE FROM social.instants WHERE id IN (
           SELECT i.id FROM social.instants i
            WHERE coalesce(i.keep_until, i.expires_at) <= now()
              AND NOT EXISTS (SELECT 1 FROM social.reports r WHERE r.target_type = 'instant' AND r.target_id = i.id AND r.status = 'open')
            LIMIT 500)
         RETURNING media_id`,
      );
      await this.dropMedia(rows.map((r) => r.media_id as string));
      instants += rows.length;
      if (rows.length < 500) break;
    }
    const recaps = await this.pool.query('DELETE FROM social.zas_recaps WHERE expires_at <= now() RETURNING id, media_id');
    await this.afterRecapsGone(recaps.rows);
    if (instants || recaps.rowCount) this.log.log(`limpeza: ${instants} Zás e ${recaps.rowCount ?? 0} resumos apagados`);
    return { instants, recaps: recaps.rowCount ?? 0 };
  }

  // ── O resumo de domingo à noite ────────────────────────────────────────────────────────────────────────────────

  /**
   * Faz os resumos da semana que acabou (só na janela de domingo à noite; nos testes passa-se `now`): para quem tem a
   * definição ligada e pelo menos RECAP_MIN Zás guardados na semana, uma imagem com até RECAP_MAX fotos, uma vez por semana
   * (social.zas_recaps, chave pessoa + semana), e o aviso. Devolve quantos fez.
   */
  async run(opts: { now?: Date; onlyUsers?: string[]; limit?: number } = {}): Promise<{ made: number; outside: boolean }> {
    const week = recapWeek(opts.now ?? new Date());
    if (!week) return { made: 0, outside: true };
    const { rows } = await this.pool.query(
      `SELECT u.id, u.username, u.verified, u.verified_tier, count(*)::int AS n
         FROM identity.users u
         JOIN social.instants i ON i.author_id = u.id
         JOIN content.media_assets m ON m.id = i.media_id AND m.status = 'ready'
        WHERE u.status = 'active' AND u.zas_keep
          AND i.created_at >= $1 AND i.created_at < $2 AND i.keep_until > now()
          AND ($3::uuid[] IS NULL OR u.id = ANY($3::uuid[]))
          AND NOT EXISTS (SELECT 1 FROM social.zas_recaps z WHERE z.user_id = u.id AND z.week_end = $4::date)
        GROUP BY u.id
       HAVING count(*) >= $5
        ORDER BY u.id LIMIT $6`,
      [week.start, week.end, opts.onlyUsers ?? null, week.to, RECAP_MIN, opts.limit ?? RECAP_BATCH],
    );
    let made = 0;
    for (const u of rows) {
      try {
        if (await this.makeOne(u, week)) made++;
      } catch (e) {
        this.log.warn(`resumo dos Zás de ${u.id as string} falhou: ${(e as Error).message}`);
      }
    }
    return { made, outside: false };
  }

  private async makeOne(u: Record<string, unknown>, week: { from: string; to: string; start: Date; end: Date }): Promise<boolean> {
    const uid = u.id as string;
    const shots = (
      await this.pool.query(
        `SELECT i.media_id FROM social.instants i JOIN content.media_assets m ON m.id = i.media_id AND m.status = 'ready'
          WHERE i.author_id = $1 AND i.created_at >= $2 AND i.created_at < $3 AND i.keep_until > now() ORDER BY i.created_at`,
        [uid, week.start, week.end],
      )
    ).rows.map((r) => r.media_id as string);
    const photos: Buffer[] = [];
    for (const id of pickRecapPhotos(shots, RECAP_MAX)) {
      try {
        photos.push(await this.media.chatBytes(id));
      } catch {
        /* a foto já não está no armazenamento: fica de fora */
      }
    }
    if (!photos.length) return false;
    const seal: SealTier | null = tierOf(u.verified, u.verified_tier);
    const jpg = await renderZasRecap({ photos, from: week.from, to: week.to, count: shots.length, username: u.username as string, seal });
    const mediaId = await this.media.storeDerived(uid, jpg, 'image/jpeg', 'chat', null, { signed: true, width: RECAP_OUT.W, height: RECAP_OUT.H });
    const id = uuidv7();
    const ins = await this.pool.query(
      `INSERT INTO social.zas_recaps (id, user_id, week_start, week_end, media_id, instant_count, photo_count, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(days => $8)) ON CONFLICT (user_id, week_end) DO NOTHING`,
      [id, uid, week.from, week.to, mediaId, shots.length, photos.length, ZAS_KEEP_DAYS],
    );
    if (!ins.rowCount) {
      // Outra volta já o fez: esta imagem não serve.
      await this.dropMedia([mediaId]);
      return false;
    }
    await this.notifications.notifyZasRecap(uid, { id, label: recapRange(week.from, week.to), count: shots.length });
    return true;
  }

  // ── Ver, guardar, publicar e descartar ─────────────────────────────────────────────────────────────────────────

  private dto(r: RecapRow) {
    const from = dateOnly(r.week_start), to = dateOnly(r.week_end);
    return {
      id: r.id,
      url: this.media.chatUrl(r.media_id),
      weekStart: from,
      weekEnd: to,
      label: recapRange(from, to),
      count: r.instant_count,
      photos: r.photo_count,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      // Publicado num mimo que ainda existe (apagado o mimo, volta a poder publicar-se).
      published: r.story_id ? { storyId: r.story_id, audience: r.published_audience ?? 'all', at: r.published_at } : null,
    };
  }

  private async row(me: string, id: string): Promise<RecapRow> {
    const r = (
      await this.pool.query(
        `SELECT z.* FROM social.zas_recaps z JOIN content.media_assets m ON m.id = z.media_id AND m.status = 'ready'
          WHERE z.id = $1 AND z.user_id = $2 AND z.expires_at > now()`,
        [id, me],
      )
    ).rows[0] as RecapRow | undefined;
    if (!r) throw new NotFoundException('Este resumo já não existe');
    return r;
  }

  /** Os meus resumos (o mais recente primeiro). Só eu os vejo. */
  async list(me: string) {
    const { rows } = await this.pool.query(
      `SELECT z.* FROM social.zas_recaps z JOIN content.media_assets m ON m.id = z.media_id AND m.status = 'ready'
        WHERE z.user_id = $1 AND z.expires_at > now() ORDER BY z.week_end DESC, z.id DESC`,
      [me],
    );
    return rows.map((r) => this.dto(r as RecapRow));
  }

  async get(me: string, id: string) {
    return this.dto(await this.row(me, id));
  }

  /** A imagem do resumo (já com a assinatura), para guardar ou partilhar fora da app. */
  async download(me: string, id: string): Promise<{ mime: string; bytes: Buffer; filename: string }> {
    const r = await this.row(me, id);
    return { mime: 'image/jpeg', bytes: await this.media.chatBytes(r.media_id), filename: `txillapp-resumo-zas-${dateOnly(r.week_end)}.jpg` };
  }

  /**
   * Publicar o resumo nos mimos, para os amigos ('all') ou só os amigos próximos: uma cópia pública da imagem (já
   * assinada) vira um mimo-imagem como qualquer outro (StoriesService.create). 409 se já está num mimo que ainda existe.
   */
  async publish(me: string, id: string, audience: Audience) {
    const r = await this.row(me, id);
    if (r.story_id) throw new ConflictException('Este resumo já está nos teus mimos');
    const bytes = await this.media.chatBytes(r.media_id);
    const copy = await this.media.storeDerived(me, bytes, 'image/jpeg', 'public', null, { signed: true, width: RECAP_OUT.W, height: RECAP_OUT.H });
    const story = (await this.stories().create(me, copy, '', audience)) as { id: string };
    const upd = await this.pool.query(
      `UPDATE social.zas_recaps SET story_id = $3, published_audience = $4, published_at = now() WHERE id = $1 AND user_id = $2 AND story_id IS NULL`,
      [id, me, story.id, audience],
    );
    if (!upd.rowCount) {
      // Publicado ao mesmo tempo noutro aparelho: este mimo a mais sai.
      await this.stories().remove(me, story.id).catch(() => undefined);
      throw new ConflictException('Este resumo já está nos teus mimos');
    }
    return { storyId: story.id, recap: await this.get(me, id) };
  }

  /** Descartar o resumo (a imagem privada; um mimo já publicado fica, é um mimo como os outros). */
  async remove(me: string, id: string) {
    const r = await this.pool.query('DELETE FROM social.zas_recaps WHERE id = $1 AND user_id = $2 RETURNING id, media_id', [id, me]);
    if (!r.rowCount) throw new NotFoundException('Este resumo já não existe');
    await this.afterRecapsGone(r.rows);
  }
}

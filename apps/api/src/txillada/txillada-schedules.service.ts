import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException,
  OnModuleInit, ServiceUnavailableException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { badge } from '../common/badge';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { NotificationsService } from '../notifications/notifications.service';
import { Scheduler } from '../realtime/scheduler';
import { TextFilter } from '../safety/text-filter.service';
import { RATE_STORE, type RateStore } from '../security/rate-store';
import { ModerationService, type ReportReason } from '../moderation/moderation.service';
import { notReportedBy } from '../social/visibility';
import { livekitEnabled } from './livekit';
import { assertCanHost } from './txillada-host';
import { txilladaVisible } from './txillada-visibility';

/**
 * Txillada agendada (0176) — docs/txillada-agendar.md. O anfitrião marca dia e hora; quem a pode ver pede «Lembrar-me»; na
 * hora o anfitrião começa com as escolhas que já fez (POST /txilladas com `scheduleId`, no TxilladaService). Aqui ficam o
 * agendamento, os lembretes, os avisos ao anfitrião (15 min antes e na hora), expirar e limpar.
 */
export type ScheduleAudience = 'everyone' | 'friends' | 'close' | 'paid';
export type ScheduleStatus = 'scheduled' | 'started' | 'cancelled' | 'expired' | 'removed';

/** A hora: pelo menos 15 minutos à frente (com 1 minuto de folga para o pedido chegar) e no máximo 30 dias. */
export const SCHEDULE_MIN_AHEAD_MS = 15 * 60_000;
export const SCHEDULE_MAX_AHEAD_MS = 30 * 86_400_000;
const AHEAD_GRACE_MS = 60_000;
/** No máximo 5 agendamentos à espera por anfitrião, a pelo menos 30 minutos uns dos outros. */
export const SCHEDULES_MAX = 5;
export const SCHEDULE_GAP_MS = 30 * 60_000;
/** Começar: a partir de 60 minutos antes da hora (também a ligação automática de uma Txillada normal). */
export const START_EARLY_MS = 60 * 60_000;
/** Mudar a hora mais do que isto avisa quem pediu lembrete. */
export const MOVED_NOTICE_MS = 15 * 60_000;
/** O aviso ao anfitrião antes da hora. */
export const HOST_SOON_MS = 15 * 60_000;
/** Sem começar 2 horas depois da hora, expira. */
export const EXPIRE_AFTER_MS = 2 * 3_600_000;
/** Os cancelados e expirados apagam-se ao fim destes dias (com os lembretes). */
export const SCHEDULE_KEEP_DAYS = 30;
/** «Lembrar-me» e tirar: no máximo 60 pedidos por minuto por pessoa. */
const REMINDS_PER_MIN = 60;
const UPCOMING_MAX = 20;
const UPCOMING_MS = 48 * 3_600_000;

const NOT_FOUND = 'Txillada agendada não encontrada';
const NOT_SCHEDULED = 'Esta Txillada já não está agendada.';
const UNAVAILABLE = 'A Txillada ainda não está disponível.';

const avatarUrl = (username: string, has: unknown) => (has ? `/api/v1/avatars/${encodeURIComponent(username)}` : null);
const iso = (v: unknown) => new Date(v as string).toISOString();
const txKind = (a: string) => (a === 'paid' ? 'paid' : a === 'friends' || a === 'close' ? 'friends' : 'public');

/** As colunas de um agendamento (`s`) e do anfitrião (`h`) para o dto, como `v` o vê. */
const COLS = (v = '$1') => `s.id, s.host_id, s.title, s.audience, s.price, s.goal, s.goal_purpose, s.starts_at, s.status, s.txillada_id, s.created_at,
  h.username AS h_username, h.display_name AS h_display_name, (h.avatar_media_id IS NOT NULL) AS h_has_avatar, h.verified AS h_verified, h.verified_tier AS h_verified_tier,
  COALESCE((SELECT tx.status = 'live' FROM content.txilladas tx WHERE tx.id = s.txillada_id), false) AS tx_live,
  EXISTS (SELECT 1 FROM content.txillada_schedule_reminders r WHERE r.schedule_id = s.id AND r.user_id = ${v}) AS reminded,
  COALESCE(s.reminders_count, (SELECT count(*)::int FROM content.txillada_schedule_reminders r JOIN identity.users ru ON ru.id = r.user_id AND ru.status = 'active'
    WHERE r.schedule_id = s.id)) AS reminders`;
const FROM = `FROM content.txillada_schedules s JOIN identity.users h ON h.id = s.host_id`;
/** Quem pode ver o agendamento e não o denunciou (o que se denuncia deixa de aparecer a quem denunciou). */
const SEES = (v = '$1') => `(${txilladaVisible('s', 'h', v)} AND ${notReportedBy('txillada_schedule', 's.id', v)})`;

export type ScheduledTxillada = ReturnType<TxilladaSchedulesService['dto']>;

@Injectable()
export class TxilladaSchedulesService implements OnModuleInit {
  private readonly log = new Logger('TxilladaAgendada');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(RATE_STORE) private readonly rates: RateStore,
    private readonly scheduler: Scheduler,
    private readonly filter: TextFilter,
    private readonly notifications: NotificationsService,
    private readonly moderation: ModerationService,
  ) {}

  /** De minuto a minuto: os avisos ao anfitrião e expirar; de hora a hora: apagar os cancelados e expirados antigos. */
  onModuleInit() {
    this.scheduler.every('txillada.schedules', 60_000, () => this.tick(), { firstAfterMs: 15_000 });
    this.scheduler.every('txillada.schedules.purge', 3_600_000, () => this.purge(), { firstAfterMs: 90_000 });
  }

  dto(r: Record<string, any>, me: string) {
    const isHost = r.host_id === me;
    const kind = txKind(r.audience as string);
    const goal = r.goal == null ? null : Number(r.goal);
    return {
      id: r.id as string,
      host: {
        id: r.host_id as string,
        username: r.h_username as string,
        displayName: r.h_display_name as string,
        avatarUrl: avatarUrl(r.h_username as string, r.h_has_avatar),
        ...badge(r.h_verified, r.h_verified_tier),
      },
      title: r.title as string,
      audience: r.audience as ScheduleAudience,
      kind,
      price: kind === 'paid' ? Number(r.price) : null,
      goal,
      goalPurpose: goal == null ? '' : ((r.goal_purpose as string | null) ?? ''),
      startsAt: iso(r.starts_at),
      status: r.status as ScheduleStatus,
      txilladaId: r.status === 'started' ? ((r.txillada_id as string | null) ?? null) : null,
      live: r.status === 'started' && !!r.tx_live,
      isHost,
      reminded: !isHost && !!r.reminded,
      reminders: isHost ? Number(r.reminders ?? 0) : null,
      createdAt: iso(r.created_at),
    };
  }

  private assertEnabled() {
    if (!livekitEnabled(this.config)) throw new ServiceUnavailableException(UNAVAILABLE);
  }

  /** 400 se a hora está fora dos limites (`now`: «começar agora» é tratado à parte, no update). */
  private assertWhen(at: Date) {
    const ms = at.getTime();
    if (Number.isNaN(ms)) throw new BadRequestException('Hora inválida.');
    const ahead = ms - Date.now();
    if (ahead < SCHEDULE_MIN_AHEAD_MS - AHEAD_GRACE_MS) throw new BadRequestException('Agenda a Txillada com pelo menos 15 minutos de antecedência.');
    if (ahead > SCHEDULE_MAX_AHEAD_MS) throw new BadRequestException('Só podes agendar uma Txillada até 30 dias à frente.');
  }

  /**
   * As regras dos agendamentos de um anfitrião, com o lock dele já tomado: no máximo 5 à espera (409 `too_many`) e nenhum
   * outro a menos de 30 minutos (409 `too_close`). `except`: o próprio, ao editar.
   */
  private async assertSlot(c: PoolClient, me: string, at: Date, except: string | null) {
    const { rows } = await c.query(
      `SELECT count(*)::int AS n,
              bool_or(abs(extract(epoch FROM (starts_at - $2::timestamptz))) * 1000 < $4) AS close
         FROM content.txillada_schedules WHERE host_id = $1 AND status = 'scheduled' AND ($3::uuid IS NULL OR id <> $3)`,
      [me, at.toISOString(), except, SCHEDULE_GAP_MS],
    );
    if (!except && rows[0].n >= SCHEDULES_MAX) {
      throw new ConflictException({ message: `Já tens ${SCHEDULES_MAX} Txilladas agendadas. Cancela uma para agendar outra.`, code: 'too_many' });
    }
    if (rows[0].close) {
      throw new ConflictException({ message: 'Já tens uma Txillada agendada a menos de 30 minutos desta hora.', code: 'too_close' });
    }
  }

  private async locked<T>(me: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('txsched:' || $1::text))`, [me]);
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  private async row(me: string, id: string) {
    const { rows } = await this.pool.query(`SELECT ${COLS('$1')}, ${SEES('$1')} AS visible ${FROM} WHERE s.id = $2`, [me, id]);
    return rows[0] as Record<string, any> | undefined;
  }

  /** O agendamento como `me` o vê, ou 404. */
  private async visibleRow(me: string, id: string) {
    const r = await this.row(me, id);
    if (!r || !r.visible) throw new NotFoundException(NOT_FOUND);
    return r;
  }

  /** O agendamento do anfitrião `me`, ou 404 (não o vê) / 403 (vê, mas não é dele). */
  private async hostRow(me: string, id: string) {
    const r = await this.visibleRow(me, id);
    if (r.host_id !== me) throw new ForbiddenException('Só o anfitrião pode mudar esta Txillada.');
    return r;
  }

  /* ───────────── criar, ver, editar, cancelar ───────────── */

  async create(me: string, b: { title?: string; audience: ScheduleAudience; price?: number | null; goal?: number | null; goalPurpose?: string; startsAt: string }) {
    this.assertEnabled();
    await assertCanHost(this.pool, me);
    const audience = b.audience;
    const price = audience === 'paid' ? (b.price ?? null) : null;
    if (audience === 'paid' && (price == null || !Number.isInteger(price) || price < 5 || price > 5000)) {
      throw new BadRequestException('Numa Txillada privada, a entrada vai de 5 a 5000 vibes.');
    }
    const goal = b.goal ?? null;
    if (goal != null && (!Number.isInteger(goal) || goal < 10 || goal > 1_000_000)) {
      throw new BadRequestException('A meta da angariação vai de 10 a 1000000 vibes.');
    }
    const title = (b.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const purpose = goal == null ? '' : (b.goalPurpose ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const at = new Date(b.startsAt);
    this.assertWhen(at);
    this.filter.assertClean(title);
    if (purpose) this.filter.assertClean(purpose);
    const id = uuidv7();
    await this.locked(me, async (c) => {
      await this.assertSlot(c, me, at, null);
      await c.query(
        `INSERT INTO content.txillada_schedules (id, host_id, title, audience, price, goal, goal_purpose, starts_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, me, title, audience, price, goal, purpose, at.toISOString()],
      );
    });
    return this.get(me, id);
  }

  async get(me: string, id: string) {
    return this.dto(await this.visibleRow(me, id), me);
  }

  /** Os 'scheduled' de um anfitrião que eu posso ver, por hora (sem `username`: os meus). */
  async list(me: string, username?: string) {
    let hostId = me;
    if (username) {
      const u = (await this.pool.query(`SELECT id FROM identity.users WHERE lower(username) = lower($1) AND status = 'active'`, [username.replace(/^@/, '')])).rows[0];
      if (!u) throw new NotFoundException('Utilizador não encontrado');
      hostId = u.id as string;
    }
    const { rows } = await this.pool.query(
      `SELECT ${COLS('$1')} ${FROM} WHERE s.host_id = $2 AND s.status = 'scheduled' AND ${SEES('$1')} ORDER BY s.starts_at, s.id`,
      [me, hostId],
    );
    return { items: rows.map((r) => this.dto(r, me)) };
  }

  /** «Em breve»: os 'scheduled' das próximas 48 h de quem eu sigo e posso ver, por hora (máx. 20). */
  async upcoming(me: string) {
    const { rows } = await this.pool.query(
      `SELECT ${COLS('$1')} ${FROM}
        WHERE s.status = 'scheduled' AND s.host_id <> $1 AND s.starts_at <= now() + make_interval(secs => $2)
          AND EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = s.host_id)
          AND ${SEES('$1')}
        ORDER BY s.starts_at, s.id LIMIT $3`,
      [me, UPCOMING_MS / 1000, UPCOMING_MAX],
    );
    return { items: rows.map((r) => this.dto(r, me)) };
  }

  /**
   * Editar (o anfitrião): o título e a hora, com as mesmas regras; o tipo, o preço e a meta não mudam. Mudar a hora mais de
   * 15 minutos avisa quem pediu lembrete (`txillada_scheduled_cancelled` com `moved`); os avisos ao anfitrião voltam a estar
   * por mandar. «Começar agora mesmo assim»: uma hora até 1 minuto à frente (ou já passada) passa a ser agora, sem aviso de
   * mudança (o `txillada_live` chega logo a seguir) e sem os avisos ao anfitrião.
   */
  async update(me: string, id: string, b: { title?: string; startsAt?: string }) {
    // As mesmas regras de quem agenda (como o POST): com a Txillada desligada ou sem poder abrir (conta suspensa, menor), não
    // se edita. Cancelar fica sempre (ver cancel).
    this.assertEnabled();
    const r = await this.hostRow(me, id);
    await assertCanHost(this.pool, me);
    if (r.status !== 'scheduled') throw new ConflictException({ message: NOT_SCHEDULED, code: 'not_scheduled' });
    const title = b.title === undefined ? undefined : b.title.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (title) this.filter.assertClean(title);
    let at: Date | null = null;
    let now = false;
    if (b.startsAt !== undefined) {
      at = new Date(b.startsAt);
      if (Number.isNaN(at.getTime())) throw new BadRequestException('Hora inválida.');
      now = at.getTime() <= Date.now() + AHEAD_GRACE_MS;
      if (now) at = new Date();
      else this.assertWhen(at);
    }
    const before = new Date(r.starts_at as string);
    const moved = !!at && !now && Math.abs(at.getTime() - before.getTime()) > MOVED_NOTICE_MS;
    await this.locked(me, async (c) => {
      if (at) await this.assertSlot(c, me, at, id);
      const upd = await c.query(
        `UPDATE content.txillada_schedules SET title = COALESCE($3, title),
                starts_at = COALESCE($4::timestamptz, starts_at),
                host_reminded_at = CASE WHEN $4::timestamptz IS NULL OR $4::timestamptz = starts_at THEN host_reminded_at WHEN $5 THEN now() ELSE NULL END,
                host_now_at = CASE WHEN $4::timestamptz IS NULL OR $4::timestamptz = starts_at THEN host_now_at WHEN $5 THEN now() ELSE NULL END,
                updated_at = now()
          WHERE id = $1 AND host_id = $2 AND status = 'scheduled'`,
        [id, me, title ?? null, at ? at.toISOString() : null, now],
      );
      if (!upd.rowCount) throw new ConflictException({ message: NOT_SCHEDULED, code: 'not_scheduled' });
    });
    if (moved && at) {
      void this.tellReminders(id, me, { moved: true, newStartsAt: at.toISOString(), startsAt: before.toISOString() })
        .catch((e) => this.log.warn(`não consegui avisar da mudança da Txillada agendada ${id}: ${(e as Error).message}`));
    }
    return this.get(me, id);
  }

  /**
   * Cancelar (o anfitrião): passa a 'cancelled' e quem pediu lembrete é avisado. Cancelar outra vez não faz nada. Deixa sempre,
   * mesmo com a Txillada desligada ou a conta sem poder abrir: cancelar só faz bem a quem estava à espera.
   */
  async cancel(me: string, id: string) {
    const r = await this.hostRow(me, id);
    if (r.status === 'cancelled') return;
    if (r.status !== 'scheduled') throw new ConflictException({ message: NOT_SCHEDULED, code: 'not_scheduled' });
    const upd = await this.pool.query(
      `UPDATE content.txillada_schedules SET status = 'cancelled', updated_at = now() WHERE id = $1 AND host_id = $2 AND status = 'scheduled'`,
      [id, me],
    );
    if (!upd.rowCount) throw new ConflictException({ message: NOT_SCHEDULED, code: 'not_scheduled' });
    void this.tellReminders(id, me, { moved: false, startsAt: iso(r.starts_at) })
      .catch((e) => this.log.warn(`não consegui avisar do cancelamento da Txillada agendada ${id}: ${(e as Error).message}`));
  }

  /**
   * O aviso `txillada_scheduled_cancelled` a quem pediu lembrete e ainda a pode ver (cancelada, a hora mudou, ou `removed`:
   * retirada pela moderação).
   */
  private async tellReminders(id: string, hostId: string, d: { moved: boolean; startsAt: string; newStartsAt?: string; removed?: boolean }) {
    const { rows } = await this.pool.query(
      `SELECT r.user_id, s.title FROM content.txillada_schedule_reminders r
         JOIN content.txillada_schedules s ON s.id = r.schedule_id
         JOIN identity.users h ON h.id = s.host_id
         JOIN identity.users v ON v.id = r.user_id AND v.status = 'active'
        WHERE r.schedule_id = $1 AND ${txilladaVisible('s', 'h', 'r.user_id')}`,
      [id],
    );
    for (const x of rows) {
      await this.notifications.notify({
        userId: x.user_id as string,
        actorId: hostId,
        kind: 'txillada_scheduled_cancelled',
        data: {
          scheduleId: id, startsAt: d.startsAt, title: x.title as string, moved: d.moved,
          ...(d.newStartsAt ? { newStartsAt: d.newStartsAt } : {}), ...(d.removed ? { removed: true } : {}),
        },
      });
    }
    return rows.length;
  }

  /**
   * Os lembretes já não servem (começou, ou foi retirada): apagam-se e o número (contas ativas, como a app e o aviso «é agora»)
   * fica em `reminders_count`, para o anfitrião continuar a ver quantos pediram e para a exportação.
   */
  async settleReminders(id: string) {
    await this.pool.query(
      `WITH d AS (DELETE FROM content.txillada_schedule_reminders WHERE schedule_id = $1 RETURNING user_id)
       UPDATE content.txillada_schedules s
          SET reminders_count = COALESCE(s.reminders_count, 0) + (SELECT count(*)::int FROM d JOIN identity.users ru ON ru.id = d.user_id AND ru.status = 'active')
        WHERE s.id = $1`,
      [id],
    );
  }

  /* ───────────── denunciar e retirar ───────────── */

  /**
   * Denunciar (quem a pode ver, não o anfitrião): a mesma fila da moderação ('txillada_schedule'), os mesmos motivos. Quem
   * denuncia deixa de a ver (o cartão, o perfil, «Em breve» e a lista do perfil) e o lembrete que tinha sai.
   */
  async report(me: string, id: string, reason: ReportReason, note?: string) {
    const r = await this.visibleRow(me, id);
    if (r.host_id === me) throw new BadRequestException('Não podes denunciar o teu próprio conteúdo');
    if (r.status !== 'scheduled') throw new ConflictException({ message: NOT_SCHEDULED, code: 'not_scheduled' });
    await this.moderation.report(me, 'txillada_schedule', id, reason, note);
    await this.pool.query('DELETE FROM content.txillada_schedule_reminders WHERE schedule_id = $1 AND user_id = $2', [id, me]);
  }

  /**
   * Gancho da moderação (TXILLADA_HOOKS, depois do COMMIT): o agendamento já está 'removed'. Quem pediu lembrete recebe
   * `txillada_scheduled_cancelled` com `removed: true` («A Txillada de @x foi retirada») e os lembretes apagam-se.
   */
  async afterRemoved(id: string) {
    const r = (await this.pool.query(`SELECT host_id, starts_at FROM content.txillada_schedules WHERE id = $1 AND status = 'removed'`, [id])).rows[0];
    if (!r) return;
    await this.tellReminders(id, r.host_id as string, { moved: false, startsAt: iso(r.starts_at), removed: true });
    await this.settleReminders(id);
  }

  /* ───────────── lembrar-me ───────────── */

  private async remindRate(me: string) {
    if ((await this.rates.hit(`tx:remind:${me}`, 60_000)) > REMINDS_PER_MIN) {
      throw new HttpException('Calma! Muitos pedidos seguidos. Tenta daqui a pouco.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async remind(me: string, id: string) {
    this.assertEnabled();
    await this.remindRate(me);
    const r = await this.visibleRow(me, id);
    if (r.host_id === me) throw new BadRequestException('Não precisas de lembrete na tua própria Txillada.');
    if (r.status !== 'scheduled') throw new ConflictException({ message: NOT_SCHEDULED, code: 'not_scheduled' });
    // Só enquanto está à espera (começar, cancelar ou retirar pelo meio não deixa um lembrete perdido).
    const ins = await this.pool.query(
      `INSERT INTO content.txillada_schedule_reminders (schedule_id, user_id)
       SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM content.txillada_schedules WHERE id = $1 AND status = 'scheduled')
       ON CONFLICT DO NOTHING RETURNING 1`,
      [id, me],
    );
    if (!ins.rowCount) {
      const now = (await this.pool.query(`SELECT status FROM content.txillada_schedules WHERE id = $1`, [id])).rows[0];
      if (now?.status !== 'scheduled') throw new ConflictException({ message: NOT_SCHEDULED, code: 'not_scheduled' });
    }
    return { reminded: true, reminders: null };
  }

  async unremind(me: string, id: string) {
    this.assertEnabled();
    await this.remindRate(me);
    const del = await this.pool.query(`DELETE FROM content.txillada_schedule_reminders WHERE schedule_id = $1 AND user_id = $2`, [id, me]);
    // Quem já não a vê (um bloqueio entretanto) também pode tirar o lembrete que tinha.
    if (!del.rowCount) await this.visibleRow(me, id);
    return { reminded: false, reminders: null };
  }

  /* ───────────── começar (do TxilladaService) ───────────── */

  /**
   * POST /txilladas com `scheduleId`: só o anfitrião (404/403), só em 'scheduled' (409 `not_scheduled`) e a partir de 60 minutos
   * antes da hora (409 `too_early`). Devolve o título, o tipo, o preço e a meta a usar.
   */
  async forStart(me: string, id: string) {
    const r = await this.hostRow(me, id).catch((e) => {
      if (e instanceof ForbiddenException) throw new ForbiddenException('Só o anfitrião pode começar esta Txillada.');
      throw e;
    });
    if (r.status !== 'scheduled') throw new ConflictException({ message: NOT_SCHEDULED, code: 'not_scheduled' });
    if (new Date(r.starts_at as string).getTime() - Date.now() > START_EARLY_MS) {
      throw new ConflictException({ message: 'Só podes começar a partir de 1 hora antes da hora marcada.', code: 'too_early', startsAt: iso(r.starts_at) });
    }
    return {
      id: r.id as string,
      title: r.title as string,
      audience: r.audience as ScheduleAudience,
      price: r.price == null ? null : Number(r.price),
      goal: r.goal == null ? null : Number(r.goal),
      goalPurpose: (r.goal_purpose as string | null) ?? '',
    };
  }

  /**
   * Depois de abrir a Txillada `txId`: o agendamento passa a 'started' com ela. Com `scheduleId`, esse; sem ele, o meu
   * agendamento à espera mais próximo de agora que comece daqui a 60 minutos ou menos (a ligação automática). Devolve o id
   * do agendamento ligado e quem pediu lembrete (para o aviso), ou null. Depois de mandar o `txillada_live`, o TxilladaService
   * chama settleReminders: os lembretes apagam-se e o número fica em `reminders_count`.
   */
  async linkStarted(me: string, txId: string, scheduleId: string | null): Promise<{ id: string; reminders: string[] } | null> {
    const { rows } = await this.pool.query(
      `UPDATE content.txillada_schedules SET status = 'started', txillada_id = $2, updated_at = now()
        WHERE status = 'scheduled' AND host_id = $1 AND id = COALESCE($3::uuid, (
          SELECT n.id FROM content.txillada_schedules n
           WHERE n.host_id = $1 AND n.status = 'scheduled' AND n.starts_at <= now() + make_interval(secs => $4)
           ORDER BY abs(extract(epoch FROM (n.starts_at - now()))), n.id LIMIT 1))
        RETURNING id`,
      [me, txId, scheduleId, START_EARLY_MS / 1000],
    );
    if (!rows[0]) return null;
    const id = rows[0].id as string;
    const rem = await this.pool.query(`SELECT user_id FROM content.txillada_schedule_reminders WHERE schedule_id = $1 AND user_id <> $2`, [id, me]);
    return { id, reminders: rem.rows.map((x) => x.user_id as string) };
  }

  /* ───────────── tarefas ───────────── */

  /** De minuto a minuto: os avisos ao anfitrião (15 min antes e na hora, cada um só uma vez) e expirar. */
  async tick() {
    const soon = await this.hostSoon();
    const now = await this.hostNow();
    const expired = await this.expire();
    return { soon, now, expired };
  }

  /** «A tua Txillada começa daqui a 15 min» (`txillada_scheduled_soon`), uma vez, enquanto ainda não chegou a hora. */
  async hostSoon() {
    const { rows } = await this.pool.query(
      `UPDATE content.txillada_schedules s SET host_reminded_at = now()
         FROM identity.users h
        WHERE h.id = s.host_id AND h.status = 'active' AND s.status = 'scheduled' AND s.host_reminded_at IS NULL AND s.host_now_at IS NULL
          AND s.starts_at > now() AND s.starts_at <= now() + make_interval(secs => $1)
        RETURNING s.id, s.host_id, s.title, s.starts_at`,
      [HOST_SOON_MS / 1000],
    );
    for (const r of rows) {
      await this.notifications.notifySelf({
        userId: r.host_id as string,
        kind: 'txillada_scheduled_soon',
        data: { scheduleId: r.id as string, startsAt: iso(r.starts_at), title: r.title as string },
        push: { title: 'Txillada', body: 'A tua Txillada começa daqui a 15 min', url: `/txillada/agendada/${r.id as string}`, tag: `txillada-schedule:${r.id as string}` },
      });
    }
    return rows.length;
  }

  /** «Está na hora da tua Txillada. N pessoas pediram para ser lembradas.» (`txillada_scheduled_now`), uma vez. */
  async hostNow() {
    const { rows } = await this.pool.query(
      `UPDATE content.txillada_schedules s SET host_now_at = now(), host_reminded_at = COALESCE(s.host_reminded_at, now())
         FROM identity.users h
        WHERE h.id = s.host_id AND h.status = 'active' AND s.status = 'scheduled' AND s.host_now_at IS NULL
          AND s.starts_at <= now() AND s.starts_at > now() - make_interval(secs => $1)
        RETURNING s.id, s.host_id, s.title, s.starts_at,
          (SELECT count(*)::int FROM content.txillada_schedule_reminders r JOIN identity.users ru ON ru.id = r.user_id AND ru.status = 'active'
            WHERE r.schedule_id = s.id) AS reminders`,
      [EXPIRE_AFTER_MS / 1000],
    );
    for (const r of rows) {
      const n = Number(r.reminders ?? 0);
      const who = n === 1 ? ' 1 pessoa pediu para ser lembrada.' : n > 1 ? ` ${n} pessoas pediram para ser lembradas.` : '';
      await this.notifications.notifySelf({
        userId: r.host_id as string,
        kind: 'txillada_scheduled_now',
        data: { scheduleId: r.id as string, startsAt: iso(r.starts_at), title: r.title as string, reminders: n },
        push: { title: 'Txillada', body: `Está na hora da tua Txillada.${who}`, url: `/txillada/agendada/${r.id as string}`, tag: `txillada-schedule:${r.id as string}` },
      });
    }
    return rows.length;
  }

  /** 2 horas depois da hora sem começar: 'expired', sem avisos. */
  async expire() {
    const r = await this.pool.query(
      `UPDATE content.txillada_schedules SET status = 'expired', updated_at = now()
        WHERE status = 'scheduled' AND starts_at < now() - make_interval(secs => $1)`,
      [EXPIRE_AFTER_MS / 1000],
    );
    return r.rowCount ?? 0;
  }

  /**
   * Os 'cancelled', 'expired' e 'removed' com mais de 30 dias apagam-se (os lembretes vão com eles pela FK); os 'started' ficam
   * enquanto a Txillada existir (sem ela, `txillada_id` fica a NULL e saem também ao fim de 30 dias).
   */
  async purge(days = SCHEDULE_KEEP_DAYS) {
    const r = await this.pool.query(
      `DELETE FROM content.txillada_schedules
        WHERE (status IN ('cancelled', 'expired', 'removed') OR (status = 'started' AND txillada_id IS NULL))
          AND updated_at < now() - make_interval(days => $1)`,
      [days],
    );
    return r.rowCount ?? 0;
  }
}

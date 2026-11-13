import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Scheduler } from '../realtime/scheduler';
import { Pool } from 'pg';
import { ChatService } from '../chat/chat.service';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { MailService } from '../mail/mail.service';
import { comebackMail } from '../mail/templates';
import { tchekaPost } from '../posts/feed';
import { PushService } from '../push/push.service';
import { blockedBetween, canView } from '../social/visibility';
import { audienceOk } from '../stories/stories.service';
import {
  MIN_GAP_DAYS,
  MONTHLY_GAP_DAYS,
  STAGE_DAYS,
  STOP_AFTER_DAYS,
  composeMessage,
  firstName,
  sendingHours,
  ttlUntilEvening,
  unsubscribeToken,
  verifyUnsubscribeToken,
  type ComebackFacts,
} from './comeback';

/** De quanto em quanto tempo a tarefa corre. */
export const COMEBACK_EVERY_MS = 3_600_000;
/** Quantas pessoas, no máximo, em cada volta (as outras ficam para a hora seguinte). */
export const COMEBACK_BATCH = 200;
/** O registo guarda-se 180 dias (chega para o limite semanal, para as etapas e para as contas do backoffice). */
export const COMEBACK_KEEP_DAYS = 180;

/**
 * A última vez que a pessoa abriu a app: o "visto por último" (ligar e desligar o tempo real do chat), a última
 * renovação da sessão (de 10 em 10 minutos com a app aberta) e, sem nada disso, a criação da conta. `u` = identity.users.
 */
export const LAST_ACTIVE = (u = 'u') =>
  `greatest(${u}.created_at, ${u}.last_seen_at, (SELECT max(greatest(ls.created_at, ls.used_at)) FROM identity.sessions ls WHERE ls.user_id = ${u}.id))`;

export interface ComebackRunOptions {
  /** A hora "agora" (os testes simulam o tempo). */
  now?: Date;
  limit?: number;
  /** Só estas contas (testes). */
  onlyUsers?: string[];
}

export interface ComebackRunResult {
  push: number;
  email: number;
  /** Pessoas a quem já não se chegou (sem push que funcione nem e-mail). */
  failed: number;
  /** Lembretes antigos marcados como "voltou". */
  returned: number;
  /** Fora das horas: não se enviou nada. */
  outsideHours: boolean;
}

interface Candidate {
  id: string;
  username: string;
  display_name: string | null;
  email: string;
  email_ok: boolean;
  last_active: Date;
  stage: number;
}

/**
 * Lembretes de regresso: de hora a hora procura quem não abre o Txillapp há 3 dias ou mais (com conta ativa, maior de
 * idade, com os lembretes ligados e com push ou e-mail confirmado) e manda-lhe um aviso com o que há de novo para si.
 * - Etapas aos 3, 7, 14, 30 e 60 dias sem abrir; aos 90 pára de vez. Ao voltar à app, começa um ciclo novo.
 * - Nunca mais de um em cada 7 dias (também entre ciclos) e, depois dos 30 dias, no máximo um por mês.
 * - Só das 9h00 às 19h59 de Maputo; o push perde a validade às 21h00 (nunca chega de noite).
 * - Primeiro o push; se não chegar a nenhum aparelho, o e-mail (com "Deixar de receber estes lembretes").
 * - Idempotente: cada lembrete reserva primeiro a sua linha (chave única pessoa + ciclo + etapa) e só depois envia;
 *   duas voltas ao mesmo tempo nunca mandam o mesmo lembrete duas vezes.
 * Nos testes não arranca sozinha (chama-se `run()`).
 */
@Injectable()
export class ComebackReminderService implements OnModuleInit {
  private readonly log = new Logger('LembretesRegresso');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly mail: MailService,
    private readonly push: PushService,
    private readonly chat: ChatService,
    private readonly scheduler: Scheduler,
  ) {}

  onModuleInit() {
    this.scheduler.every('reminders.comeback', COMEBACK_EVERY_MS, () => this.run());
  }

  /** Uma volta: marca quem voltou, apaga o registo antigo e, dentro das horas, envia os lembretes que estão prontos. */
  async run(opts: ComebackRunOptions = {}): Promise<ComebackRunResult> {
    const now = opts.now ?? new Date();
    const res: ComebackRunResult = { push: 0, email: 0, failed: 0, returned: 0, outsideHours: !sendingHours(now) };
    res.returned = await this.markReturns(now);
    await this.pool.query(`DELETE FROM social.comeback_reminders WHERE sent_at < $1::timestamptz - make_interval(days => $2)`, [now, COMEBACK_KEEP_DAYS]);
    // Uma reserva que ficou a meio (o processo caiu entre reservar e enviar) não chegou a ninguém: sai ao fim de uma hora.
    await this.pool.query(`DELETE FROM social.comeback_reminders WHERE channel = 'pending' AND sent_at < $1::timestamptz - interval '1 hour'`, [now]);
    if (res.outsideHours) return res;
    if (!this.push.enabled && !this.mail.enabled) return res;
    for (const c of await this.candidates(now, opts.limit ?? COMEBACK_BATCH, opts.onlyUsers)) {
      try {
        const ch = await this.remind(c, now);
        if (ch === 'push') res.push++;
        else if (ch === 'email') res.email++;
        else if (ch === 'failed') res.failed++;
      } catch (e) {
        this.log.warn(`lembrete de regresso falhou: ${(e as Error).message}`);
      }
    }
    return res;
  }

  /** Quem tem um lembrete pronto agora (já com a etapa), no máximo `limit`. */
  private async candidates(now: Date, limit: number, only?: string[]): Promise<Candidate[]> {
    const { rows } = await this.pool.query(
      `WITH u AS (
         SELECT u.id, u.username, u.display_name, u.email,
                (u.email_verified_at IS NOT NULL AND u.email NOT LIKE '%@invalid.local') AS email_ok,
                (EXISTS (SELECT 1 FROM social.push_devices d WHERE d.user_id = u.id) OR EXISTS (SELECT 1 FROM social.push_subscriptions s WHERE s.user_id = u.id)) AS push_ok,
                ${LAST_ACTIVE('u')} AS last_active
           FROM identity.users u
          WHERE u.status = 'active'
            -- Menores (e quem não tem data de nascimento, que conta como menor) não recebem.
            AND u.birth_date IS NOT NULL AND u.birth_date <= (($1::timestamptz AT TIME ZONE 'Africa/Maputo')::date - interval '18 years')
            AND NOT EXISTS (SELECT 1 FROM social.notification_prefs np WHERE np.user_id = u.id AND 'comeback' = ANY (np.off))
            AND ($3::uuid[] IS NULL OR u.id = ANY ($3::uuid[]))
       ), c AS (
         SELECT u.*, floor(extract(epoch FROM ($1::timestamptz - u.last_active)) / 86400)::int AS days,
                (SELECT max(r.stage) FROM social.comeback_reminders r WHERE r.user_id = u.id AND r.sent_at > u.last_active) AS done_stage,
                (SELECT max(r.sent_at) FROM social.comeback_reminders r WHERE r.user_id = u.id) AS last_sent
           FROM u
          WHERE (u.push_ok OR (u.email_ok AND $9::boolean))
            AND u.last_active <= $1::timestamptz - make_interval(days => $4)
            AND u.last_active > $1::timestamptz - make_interval(days => $5)
       ), s AS (
         SELECT c.*, (CASE WHEN days >= $8 THEN 5 WHEN days >= $7 THEN 4 WHEN days >= $6 THEN 3 WHEN days >= $10 THEN 2 ELSE 1 END) AS stage FROM c
       )
       SELECT id, username, display_name, email, email_ok, last_active, stage FROM s
        WHERE stage > COALESCE(done_stage, 0)
          AND (last_sent IS NULL OR last_sent <= $1::timestamptz - make_interval(days => $11))
          AND (stage < 5 OR last_sent IS NULL OR last_sent <= $1::timestamptz - make_interval(days => $12))
        ORDER BY last_active, id
        LIMIT $2`,
      [now, limit, only ?? null, STAGE_DAYS[0], STOP_AFTER_DAYS, STAGE_DAYS[2], STAGE_DAYS[3], STAGE_DAYS[4], this.mail.enabled, STAGE_DAYS[1], MIN_GAP_DAYS, MONTHLY_GAP_DAYS],
    );
    return rows as Candidate[];
  }

  /** Reserva o lembrete, escolhe o texto e envia: push primeiro, e-mail se o push não chegar a lado nenhum. */
  private async remind(c: Candidate, now: Date): Promise<'push' | 'email' | 'failed' | 'taken'> {
    const id = uuidv7(now.getTime());
    const claim = await this.pool.query(
      `INSERT INTO social.comeback_reminders (id, user_id, cycle_at, stage, channel, kind, sent_at) VALUES ($1, $2, $3, $4, 'pending', 'generic', $5)
       ON CONFLICT (user_id, cycle_at, stage) DO NOTHING`,
      [id, c.id, c.last_active, c.stage, now],
    );
    if (!claim.rowCount) return 'taken'; // outra volta já lhe pegou
    // A reserva só conta se ninguém mandou outro lembrete nos últimos 7 dias (duas voltas ao mesmo tempo com etapas diferentes).
    const recent = await this.pool.query(
      `SELECT 1 FROM social.comeback_reminders WHERE user_id = $1 AND id <> $2 AND sent_at > $3::timestamptz - make_interval(days => $4) LIMIT 1`,
      [c.id, id, now, MIN_GAP_DAYS],
    );
    if (recent.rowCount) {
      await this.pool.query('DELETE FROM social.comeback_reminders WHERE id = $1', [id]);
      return 'taken';
    }
    const msg = composeMessage(await this.facts(c.id, c.username, c.last_active, now), c.stage);
    let channel: 'push' | 'email' | null = null;
    const delivered = await this.push.send(c.id, { title: msg.title, body: msg.body, url: msg.url, tag: 'comeback', category: 'comeback', ttlSeconds: ttlUntilEvening(now) });
    if (delivered > 0) channel = 'push';
    else if (c.email_ok && this.mail.enabled) {
      const ok = await this.mail.send({
        to: c.email,
        ...comebackMail(this.mail.publicUrl, firstName(c.display_name, c.username), { title: msg.title, body: msg.body, path: msg.url, unsubscribeUrl: this.unsubscribeUrl(c.id) }),
      });
      if (ok) channel = 'email';
    }
    if (!channel) {
      // Não chegou a ninguém: não conta (volta a tentar-se numa hora seguinte, se ainda houver por onde).
      await this.pool.query('DELETE FROM social.comeback_reminders WHERE id = $1', [id]);
      return 'failed';
    }
    await this.pool.query('UPDATE social.comeback_reminders SET channel = $2, kind = $3 WHERE id = $1', [id, channel, msg.kind]);
    return channel;
  }

  /** O que há mesmo de novo para esta pessoa desde `since` (sem bloqueados, só o que ela pode ver). */
  async facts(userId: string, username: string, since: Date, now: Date): Promise<ComebackFacts> {
    const list = await this.chat.list(userId).catch(() => []);
    const unreadMessages = list.filter((c) => !c.request).reduce((n, c) => n + c.unread, 0);
    const p = (
      await this.pool.query(
        `SELECT count(DISTINCT p.author_id)::int AS people,
                (array_agg(u.display_name ORDER BY p.id DESC))[1] AS display_name,
                (array_agg(u.username ORDER BY p.id DESC))[1] AS username,
                (array_agg(CASE WHEN u.show_gender THEN u.gender END ORDER BY p.id DESC))[1] AS gender
           FROM content.posts p JOIN identity.users u ON u.id = p.author_id
          WHERE p.created_at > $2 AND p.removed_at IS NULL AND p.author_id <> $1
            AND EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = p.author_id)
            AND ${canView('u', '$1')}`,
        [userId, since],
      )
    ).rows[0];
    const stories = (
      await this.pool.query(
        `SELECT count(*)::int AS n
           FROM content.stories s JOIN identity.users u ON u.id = s.author_id
          WHERE s.created_at > $2 AND s.expires_at > $3 AND s.author_id <> $1
            AND EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = s.author_id)
            AND ${canView('u', '$1')} AND ${audienceOk('s', '$1')}
            AND NOT EXISTS (SELECT 1 FROM social.story_hidden h WHERE h.owner_id = s.author_id AND h.hidden_id = $1)
            AND EXISTS (SELECT 1 FROM content.media_assets m WHERE m.id = s.media_id AND m.status = 'ready')
            AND (s.shared_post_id IS NULL OR EXISTS (SELECT 1 FROM content.posts sp WHERE sp.id = s.shared_post_id AND sp.removed_at IS NULL))`,
        [userId, since, now],
      )
    ).rows[0];
    const ch = (
      await this.pool.query(
        `SELECT * FROM (
           SELECT 'post' AS kind, p.id, ${tchekaPost('p')} AS tcheka, count(*)::int AS n
             FROM content.cheers c JOIN content.posts p ON p.id = c.post_id JOIN identity.users cu ON cu.id = c.user_id
            WHERE p.author_id = $1 AND p.removed_at IS NULL AND c.created_at > $2 AND c.user_id <> $1
              AND cu.status = 'active' AND NOT ${blockedBetween('cu.id', '$1')}
            GROUP BY p.id
           UNION ALL
           SELECT 'story', s.id, false, count(*)::int
             FROM content.story_cheers c JOIN content.stories s ON s.id = c.story_id JOIN identity.users cu ON cu.id = c.user_id
            WHERE s.author_id = $1 AND s.expires_at > $3 AND c.created_at > $2 AND c.user_id <> $1
              AND cu.status = 'active' AND NOT ${blockedBetween('cu.id', '$1')}
            GROUP BY s.id
         ) t ORDER BY n DESC, id DESC LIMIT 1`,
        [userId, since, now],
      )
    ).rows[0];
    const people = (p?.people as number | undefined) ?? 0;
    const gender = p?.gender as string | null | undefined;
    return {
      unreadMessages,
      posters: people > 0 ? { people, name: firstName(p.display_name as string | null, p.username as string), article: gender === 'female' ? 'A' : gender === 'male' ? 'O' : null } : null,
      newStories: (stories?.n as number | undefined) ?? 0,
      cheers: ch
        ? {
            count: ch.n as number,
            target: ch.kind === 'story' ? 'story' : ch.tcheka ? 'tcheka' : 'post',
            url: ch.kind === 'story' ? `/stories/${username}` : `/p/${ch.id as string}`,
          }
        : null,
    };
  }

  /** Quem voltou a abrir a app depois de um lembrete (só os das últimas 72 h; as contas do backoffice usam as 48 h). */
  private async markReturns(now: Date): Promise<number> {
    const r = await this.pool.query(
      `UPDATE social.comeback_reminders r SET returned_at = x.la
         FROM (SELECT u.id, ${LAST_ACTIVE('u')} AS la FROM identity.users u
                WHERE u.id IN (SELECT user_id FROM social.comeback_reminders WHERE returned_at IS NULL AND channel <> 'pending' AND sent_at > $1::timestamptz - interval '72 hours')) x
        WHERE r.user_id = x.id AND r.returned_at IS NULL AND r.channel <> 'pending' AND r.sent_at > $1::timestamptz - interval '72 hours' AND x.la > r.sent_at`,
      [now],
    );
    return r.rowCount ?? 0;
  }

  // ---------- Deixar de receber ----------

  unsubscribeUrl(userId: string) {
    return `${this.mail.publicUrl}/api/v1/comeback/unsubscribe?token=${encodeURIComponent(unsubscribeToken(this.config.JWT_ACCESS_SECRET, userId))}`;
  }

  /** Desliga os lembretes desta conta (o mesmo que desligar o interruptor nas Definições). Falso se o token não serve. */
  async unsubscribe(token: string): Promise<boolean> {
    const userId = verifyUnsubscribeToken(this.config.JWT_ACCESS_SECRET, token);
    if (!userId) return false;
    const r = await this.pool.query(
      `INSERT INTO social.notification_prefs (user_id, off)
       SELECT id, ARRAY['comeback'] FROM identity.users WHERE id = $1 AND status = 'active'
       ON CONFLICT (user_id) DO UPDATE SET off = CASE WHEN 'comeback' = ANY (social.notification_prefs.off) THEN social.notification_prefs.off ELSE array_append(social.notification_prefs.off, 'comeback') END,
                                           updated_at = now()`,
      [userId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  // ---------- Backoffice: só números agregados ----------

  /** Por dia, por etapa e por canal, e quantos voltaram nas 48 h seguintes (últimos `days` dias, dias de Maputo). */
  async stats(days: number, now = new Date()) {
    const q = (sql: string) => this.pool.query(sql, [days, now]).then((r) => r.rows);
    const base = `FROM social.comeback_reminders WHERE channel <> 'pending' AND sent_at > $2::timestamptz - make_interval(days => $1::int) AND sent_at <= $2::timestamptz`;
    const back = `count(*) FILTER (WHERE returned_at IS NOT NULL AND returned_at <= sent_at + interval '48 hours')::int`;
    const [totals] = await q(`SELECT count(*)::int AS sent, count(DISTINCT user_id)::int AS people, ${back} AS returned ${base}`);
    const series = await q(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(x.push, 0) AS push, COALESCE(x.email, 0) AS email, COALESCE(x.returned, 0) AS returned
         FROM generate_series(($2::timestamptz AT TIME ZONE 'Africa/Maputo')::date - ($1::int - 1), ($2::timestamptz AT TIME ZONE 'Africa/Maputo')::date, interval '1 day') d
         LEFT JOIN (SELECT (sent_at AT TIME ZONE 'Africa/Maputo')::date AS day, count(*) FILTER (WHERE channel = 'push')::int AS push,
                           count(*) FILTER (WHERE channel = 'email')::int AS email, ${back} AS returned ${base} GROUP BY 1) x ON x.day = d::date
        ORDER BY d`,
    );
    const byStage = await q(`SELECT stage, count(*)::int AS sent, ${back} AS returned ${base} GROUP BY stage ORDER BY stage`);
    const byChannel = await q(`SELECT channel, count(*)::int AS sent, ${back} AS returned ${base} GROUP BY channel ORDER BY channel`);
    const byKind = await q(`SELECT kind, count(*)::int AS sent, ${back} AS returned ${base} GROUP BY kind ORDER BY count(*) DESC`);
    return {
      days,
      totals: { sent: totals.sent as number, people: totals.people as number, returned: totals.returned as number },
      series: series as { day: string; push: number; email: number; returned: number }[],
      byStage: STAGE_DAYS.map((d, i) => {
        const r = byStage.find((x) => Number(x.stage) === i + 1);
        return { stage: i + 1, afterDays: d, sent: (r?.sent as number) ?? 0, returned: (r?.returned as number) ?? 0 };
      }),
      byChannel: (['push', 'email'] as const).map((c) => {
        const r = byChannel.find((x) => x.channel === c);
        return { channel: c, sent: (r?.sent as number) ?? 0, returned: (r?.returned as number) ?? 0 };
      }),
      byKind: byKind as { kind: string; sent: number; returned: number }[],
    };
  }
}

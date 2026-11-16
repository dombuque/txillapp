import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { pushFor } from '../chat/hidden-push';
import { ChatService } from '../chat/chat.service';
import { badge, type Badge } from '../common/badge';
import { topicLabel } from '../common/topics';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import type { NotificationKind } from '../notifications/notifications.service';
import { interestSql } from '../posts/interest';
import { PushService, type PushPayload } from '../push/push.service';
import { blockedBetween } from '../social/visibility';
import { commonTopics, DAY_STARTS_HOUR, matchScore, mixarDay, type Weights } from './mixar-pick';

/**
 * Os avisos da seleção do dia só saem entre as 08:00 e as 21:00 de Maputo (a seleção é gerada às 05:00: ninguém quer o
 * telemóvel a tocar a essa hora). A tarefa `mixar.daily` corre de 15 em 15 minutos, por isso o aviso sai na primeira volta
 * depois das 08:00 (ou logo, quando a seleção é gerada mais tarde no dia).
 */
export const DAILY_NOTICE_FROM_HOUR = 8;
export const DAILY_NOTICE_TO_HOUR = 21;
const MAPUTO_OFFSET_H = 2;
const NOTICE_BATCH = 500;

/** «Faz um Mixar com…»: quem conta como «falamos muito» (nos últimos 30 dias) e «gostos parecidos». */
export const SUGGEST_DAYS = 30;
export const SUGGEST_MIN_MESSAGES = 10;
export const SUGGEST_MIN_EACH = 3;
export const SUGGEST_MIN_MATCH = 40;
export const SUGGEST_MAX = 3;
/** «Agora não» esconde a pessoa durante 30 dias. */
export const SUGGEST_DISMISS_DAYS = 30;
/** Quantas conversas se avaliam (o perfil de temas de cada uma custa uma consulta). */
const SUGGEST_POOL = 10;
/** O mesmo limite do Mixar (mixar.service.ts MAX_ACTIVE): quem já tem 20 ativos não é sugerido. */
const MAX_ACTIVE = 20;

/** O início do dia do Mixar `day` ('YYYY-MM-DD'): as 05:00 de Maputo desse dia. */
export const mixarDayStart = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + (DAY_STARTS_HOUR - MAPUTO_OFFSET_H) * 3_600_000);
const maputoHour = (now: Date) => (now.getUTCHours() + MAPUTO_OFFSET_H) % 24;

/** Os textos dos avisos (no telemóvel; a lista da app tem os seus, com o nome e o selo de quem). */
export const MIXAR_NOTICE_TEXT = {
  daily: 'A vossa seleção de hoje está pronta',
  pick: (first: string) => `${first} já escolheu no Mixa Challenge, falta tu`,
  match: 'Acertaram no mesmo',
  differ: 'Escolheram diferente',
};

export type MixarSuggestion = { username: string; displayName: string; hasAvatar: boolean; match: number; common: { topic: string; label: string }[] } & Badge;

/**
 * Mixar: avisos e descoberta (0170, docs/mixar-contrato.md «Avisos e descoberta»).
 * - A abertura de cada Mixar por cada pessoa (POST /mixar/:id/open): a bolinha azul igual em todos os aparelhos e o «já abriu hoje».
 * - Os avisos (lista e telemóvel, categoria «Mixar»): a seleção de hoje (depois da tarefa diária, uma vez por Mixar por dia,
 *   não a quem já abriu hoje), o outro já escolheu no desafio (uma vez por desafio) e o resultado para quem escolheu primeiro.
 * - As sugestões «Faz um Mixar com…» (GET /mixar/suggestions) e o «Agora não».
 * Nunca falha a ação principal: um erro num aviso só fica registado.
 */
@Injectable()
export class MixarAvisosService {
  private readonly log = new Logger('MixarAvisos');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly push: PushService,
    private readonly chat: ChatService,
  ) {}

  /* ───────────── abrir ───────────── */

  /**
   * Abri o Mixar (o feed, ou a conversa com o convite que recebi): guarda a hora (nunca antes da última mudança do Mixar, para
   * a bolinha não voltar por causa de um pedido que chegou antes da seleção nova) e dá por lidos os avisos do Mixar na lista.
   * Idempotente. 404 se não é meu (ou já acabou); 403 com bloqueio.
   */
  async open(me: string, id: string): Promise<{ openedAt: string }> {
    const m = (
      await this.pool.query(
        `SELECT x.status, o.status AS o_status, ${blockedBetween('o.id', '$1')} AS blocked
           FROM social.mixars x JOIN identity.users o ON o.id = CASE WHEN x.user_a = $1 THEN x.user_b ELSE x.user_a END
          WHERE x.id = $2 AND (x.user_a = $1 OR x.user_b = $1)`,
        [me, id],
      )
    ).rows[0];
    if (!m || m.o_status !== 'active' || (m.status !== 'pending' && m.status !== 'active')) throw new NotFoundException('Mixar não encontrado');
    if (m.blocked) throw new ForbiddenException('Não tens acesso a este Mixar');
    const r = await this.pool.query(
      `INSERT INTO social.mixar_opens (mixar_id, user_id, opened_at)
       SELECT x.id, $1, GREATEST(now(), x.updated_at) FROM social.mixars x WHERE x.id = $2
       ON CONFLICT (mixar_id, user_id) DO UPDATE SET opened_at = GREATEST(social.mixar_opens.opened_at, EXCLUDED.opened_at)
       RETURNING opened_at`,
      [me, id],
    );
    await this.pool
      .query(
        `UPDATE social.notifications SET read_at = now()
          WHERE user_id = $1 AND kind IN ('mixar_daily', 'mixar_pick', 'mixar_result') AND data->>'mixarId' = $2 AND read_at IS NULL`,
        [me, id],
      )
      .catch(() => undefined);
    return { openedAt: (r.rows[0].opened_at as Date).toISOString() };
  }

  /* ───────────── avisos ───────────── */

  /**
   * Depois da tarefa diária (MixarService.runDaily, que chama isto no fim de cada volta): avisa cada um dos dois de cada Mixar
   * ativo com a seleção de hoje já feita (e com itens). No máximo um aviso por Mixar, por pessoa e por dia; não a quem já
   * abriu o Mixar hoje, nem num Mixar aceite já depois das 05:00 de hoje (quem aceitou viu-o logo e quem convidou recebeu o
   * «aceitou»), nem com bloqueio, conta inativa ou a categoria «Mixar» desligada; só entre as 08:00 e as 21:00 de Maputo.
   * Devolve quantos avisou.
   */
  async dailyNotices(opts: { now?: Date } = {}): Promise<number> {
    const now = opts.now ?? new Date();
    const h = maputoHour(now);
    if (h < DAILY_NOTICE_FROM_HOUR || h >= DAILY_NOTICE_TO_HOUR) return 0;
    const day = mixarDay(now);
    const start = mixarDayStart(day);
    let total = 0;
    for (let round = 0; round < 20; round++) {
      const { rows } = await this.pool.query(
        `SELECT x.id, p.me, p.other, split_part(mu.display_name, ' ', 1) AS my_first, split_part(ou.display_name, ' ', 1) AS their_first
           FROM social.mixars x
           JOIN social.mixar_days d ON d.mixar_id = x.id AND d.day = $1::date AND d.items > 0
           CROSS JOIN LATERAL (VALUES (x.user_a, x.user_b), (x.user_b, x.user_a)) AS p(me, other)
           JOIN identity.users mu ON mu.id = p.me AND mu.status = 'active'
           JOIN identity.users ou ON ou.id = p.other AND ou.status = 'active'
          WHERE x.status = 'active' AND x.accepted_at < $2 AND NOT ${blockedBetween('p.me', 'p.other')}
            AND NOT EXISTS (SELECT 1 FROM social.mixar_notices n WHERE n.mixar_id = x.id AND n.user_id = p.me AND n.kind = 'daily' AND n.ref = $4)
            AND NOT EXISTS (SELECT 1 FROM social.mixar_opens o WHERE o.mixar_id = x.id AND o.user_id = p.me AND o.opened_at >= $2)
            AND NOT EXISTS (SELECT 1 FROM social.notification_prefs np WHERE np.user_id = p.me AND 'mixar' = ANY(np.off))
          ORDER BY x.id, p.me LIMIT $3`,
        [day, start, NOTICE_BATCH, day],
      );
      for (const r of rows) {
        try {
          if (!(await this.claim(r.id as string, r.me as string, 'daily', day))) continue;
          const name = `${r.my_first as string} + ${r.their_first as string}`;
          await this.deliver(r.me as string, r.other as string, 'mixar_daily', { mixarId: r.id, name, day }, {
            title: name, body: MIXAR_NOTICE_TEXT.daily, url: `/mixar/${r.id as string}`, tag: `mixar:${r.id as string}:daily`, category: 'mixar',
            data: { kind: 'mixar_daily', mixarId: r.id as string },
          });
          total++;
        } catch (e) {
          this.log.warn(`aviso da seleção de ${r.id as string}: ${(e as Error).message}`);
        }
      }
      if (rows.length < NOTICE_BATCH) break;
    }
    return total;
  }

  /**
   * Alguém escolheu no Mixa Challenge (MixarService.pick, depois de gravar). `both` false: o outro ainda não escolheu e recebe
   * «Fulano já escolheu no Mixa Challenge, falta tu» (uma vez por desafio, mesmo que eu mude de ideias). `both` true: eu fui o
   * segundo; quem escolheu primeiro recebe o resultado («Acertaram no mesmo» / «Escolheram diferente», uma vez) e o meu
   * «falta tu» na lista fica lido. Nunca falha.
   */
  async picked(p: { mixarId: string; me: string; other: string; myFirst: string; theirFirst: string; challengeId: string; both: boolean; match: boolean | null }): Promise<void> {
    try {
      const name = `${p.theirFirst} + ${p.myFirst}`; // visto por quem recebe (o outro)
      const url = `/mixar/${p.mixarId}`;
      if (p.both) {
        await this.pool.query(
          `UPDATE social.notifications SET read_at = now() WHERE user_id = $1 AND kind = 'mixar_pick' AND data->>'challengeId' = $2 AND read_at IS NULL`,
          [p.me, p.challengeId],
        );
      }
      if ((await this.push.off(p.other)).includes('mixar')) return;
      const kind = p.both ? 'result' : 'pick';
      if (!(await this.claim(p.mixarId, p.other, kind, p.challengeId))) return;
      if (p.both) {
        await this.deliver(p.other, p.me, 'mixar_result', { mixarId: p.mixarId, name, challengeId: p.challengeId, match: !!p.match }, {
          title: name, body: p.match ? MIXAR_NOTICE_TEXT.match : MIXAR_NOTICE_TEXT.differ, url, tag: `mixar:${p.mixarId}:challenge`, category: 'mixar',
          data: { kind: 'mixar_result', mixarId: p.mixarId },
        });
      } else {
        await this.deliver(p.other, p.me, 'mixar_pick', { mixarId: p.mixarId, name, challengeId: p.challengeId }, {
          title: name, body: MIXAR_NOTICE_TEXT.pick(p.myFirst), url, tag: `mixar:${p.mixarId}:challenge`, category: 'mixar',
          data: { kind: 'mixar_pick', mixarId: p.mixarId },
        });
      }
    } catch (e) {
      this.log.warn(`aviso do desafio ${p.challengeId}: ${(e as Error).message}`);
    }
  }

  /** Marca o aviso como mandado; false se já tinha sido (dois ao mesmo tempo: só um passa). */
  private async claim(mixarId: string, userId: string, kind: 'daily' | 'pick' | 'result', ref: string): Promise<boolean> {
    const r = await this.pool.query(
      'INSERT INTO social.mixar_notices (mixar_id, user_id, kind, ref) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [mixarId, userId, kind, ref],
    );
    return !!r.rowCount;
  }

  /** A linha na lista e o aviso no telemóvel (discreto se a conversa com o outro está oculta, como o convite). */
  private async deliver(userId: string, actorId: string, kind: NotificationKind, data: Record<string, unknown>, payload: PushPayload) {
    await this.pool.query('INSERT INTO social.notifications (id, user_id, actor_id, kind, data) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), userId, actorId, kind, data]);
    if (!this.push.enabled) return;
    const hidden = await this.chat.hiddenBy(userId, actorId).catch(() => false);
    void this.push.send(userId, pushFor(payload, hidden)).catch(() => undefined);
  }

  /* ───────────── sugestões ───────────── */

  /**
   * «Faz um Mixar com…»: até 3 pessoas com quem falei muito nos últimos 30 dias (pelo menos 10 mensagens, 3 de cada lado),
   * que me seguem e eu sigo, sem Mixar ativo ou pendente entre nós, sem bloqueios, a quem posso mandar mensagens, que eu não
   * dispensei nos últimos 30 dias e com gostos parecidos (o perfil de temas do Explorar; `match` 0–100, no mínimo 40). As que
   * batem mais e com quem falo mais vêm primeiro. Com 20 Mixar ativos, nenhuma.
   */
  async suggestions(me: string): Promise<{ items: MixarSuggestion[] }> {
    await this.pool.query('DELETE FROM social.mixar_suggestion_dismissals WHERE user_id = $1 AND until < now()', [me]);
    const mine = (await this.pool.query(`SELECT count(*)::int AS n FROM social.mixars WHERE (user_a = $1 OR user_b = $1) AND status = 'active'`, [me])).rows[0].n as number;
    if (mine >= MAX_ACTIVE) return { items: [] };
    const { rows } = await this.pool.query(
      `WITH talk AS (
         SELECT CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END AS other,
                count(*) FILTER (WHERE m.sender_id = $1)::int AS mine,
                count(*) FILTER (WHERE m.sender_id <> $1)::int AS theirs
           FROM social.conversations c
           JOIN social.messages m ON m.conversation_id = c.id AND m.created_at > now() - make_interval(days => $2)
          WHERE (c.user_a = $1 OR c.user_b = $1) AND c.last_message_at > now() - make_interval(days => $2)
          GROUP BY 1
       )
       SELECT u.id, u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar, u.verified, u.verified_tier, t.mine + t.theirs AS total
         FROM talk t JOIN identity.users u ON u.id = t.other AND u.status = 'active'
        WHERE t.mine >= $3 AND t.theirs >= $3 AND t.mine + t.theirs >= $4
          AND EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = u.id)
          AND EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id AND f.followee_id = $1)
          AND NOT ${blockedBetween('u.id', '$1')}
          AND NOT EXISTS (SELECT 1 FROM social.mixars x WHERE x.user_a = LEAST($1::uuid, u.id) AND x.user_b = GREATEST($1::uuid, u.id) AND x.status IN ('pending', 'active'))
          AND NOT EXISTS (SELECT 1 FROM social.mixar_suggestion_dismissals sd WHERE sd.user_id = $1 AND sd.person_id = u.id AND sd.until > now())
          AND (SELECT count(*) FROM social.mixars x WHERE (x.user_a = u.id OR x.user_b = u.id) AND x.status = 'active') < $5
        ORDER BY t.mine + t.theirs DESC, u.id LIMIT $6`,
      [me, SUGGEST_DAYS, SUGGEST_MIN_EACH, SUGGEST_MIN_MESSAGES, MAX_ACTIVE, SUGGEST_POOL],
    );
    if (!rows.length) return { items: [] };
    const myProfile = await this.profile(me);
    const scored: (MixarSuggestion & { rank: number })[] = [];
    for (const r of rows) {
      if (await this.chat.cannotMessage(me, r.id as string)) continue;
      const theirs = await this.profile(r.id as string);
      const match = matchScore(myProfile, theirs);
      if (match < SUGGEST_MIN_MATCH) continue;
      scored.push({
        username: r.username as string,
        displayName: r.display_name as string,
        hasAvatar: !!r.has_avatar,
        ...badge(r.verified, r.verified_tier),
        match,
        common: commonTopics(myProfile, theirs, 3).map((c) => ({ topic: c.topic, label: topicLabel(c.topic) })),
        rank: match + Math.min(30, Number(r.total) / 2),
      });
    }
    scored.sort((a, b) => b.rank - a.rank || a.username.localeCompare(b.username));
    return { items: scored.slice(0, SUGGEST_MAX).map(({ rank: _rank, ...s }) => s) };
  }

  /** «Agora não»: esta pessoa sai das sugestões durante 30 dias. 404 se a conta não existe. */
  async dismiss(me: string, username: string): Promise<void> {
    const o = (await this.pool.query(`SELECT id FROM identity.users WHERE lower(username) = lower($1) AND status = 'active'`, [username.trim().replace(/^@/, '')])).rows[0];
    if (!o || o.id === me) throw new NotFoundException('Essa pessoa não existe');
    await this.pool.query(
      `INSERT INTO social.mixar_suggestion_dismissals (user_id, person_id, until) VALUES ($1, $2, now() + make_interval(days => $3))
       ON CONFLICT (user_id, person_id) DO UPDATE SET until = EXCLUDED.until`,
      [me, o.id, SUGGEST_DISMISS_DAYS],
    );
  }

  /** O perfil de temas de uma pessoa (o mesmo do Explorar, como em MixarService). */
  private async profile(userId: string): Promise<Weights> {
    const { rows } = await this.pool.query(interestSql('$1'), [userId]);
    return Object.fromEntries(rows.map((r) => [r.topic as string, Number(r.wt)]));
  }
}

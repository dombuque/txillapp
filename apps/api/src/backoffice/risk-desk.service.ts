import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { RISK } from '../security/rules';
import { BackofficeService } from './backoffice.service';

export type RiskQueueState = 'flagged' | 'limited' | 'cleared' | 'suspended';
export const RISK_QUEUE_STATES: readonly RiskQueueState[] = ['flagged', 'limited', 'cleared', 'suspended'];
export type RiskDecision = 'clear' | 'limit' | 'suspend';

/** Nomes legíveis dos sinais (para a fila). */
export const SIGNAL_LABELS: Record<string, string> = {
  mesmo_ip: 'Várias contas novas do mesmo IP',
  mesma_rede: 'Muitas contas novas da mesma rede',
  mesmo_aparelho: 'Várias contas na mesma instalação da app',
  mesmo_email: 'Mesmo email de outra conta (disfarçado)',
  nome_gerado: 'Nome ou @ com cara de gerado',
  sem_prova: 'Sem prova de humano (app antiga)',
  rajada_seguir: 'Seguiu muita gente numa hora',
  rajada_mensagens: 'Escreveu a muita gente numa hora',
  mensagens_iguais: 'A mesma mensagem para várias pessoas',
  rajada_geladas: 'Muitos pedidos de gelada numa hora',
  rajada_convites: 'Entrou numa rajada de convites do mesmo código',
};

/**
 * Backoffice › Contas suspeitas: a fila das contas novas com pontuação de risco alta e as decisões da equipa
 * (confirmar como verdadeira, limitar, suspender). Cada decisão fica no registo de auditoria. Nunca mostra IP nem email
 * completo: só quantas outras contas partilham o IP, a rede, o aparelho ou o email.
 */
@Injectable()
export class RiskDeskService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool, private readonly bo: BackofficeService) {}

  async queue(state: RiskQueueState, cursor?: string) {
    const { rows } = await this.pool.query(
      `SELECT a.user_id, a.score, a.signals, a.state, a.flagged_at, a.limited_until, a.client, a.human, a.reviewed_at, a.review_note, a.created_at AS scored_at,
              u.username, u.display_name, u.email, u.created_at, u.status, u.email_verified_at IS NOT NULL AS email_verified,
              (SELECT count(*)::int FROM security.account_risk o WHERE a.ip_hash IS NOT NULL AND o.ip_hash = a.ip_hash AND o.user_id <> a.user_id) AS same_ip,
              (SELECT count(*)::int FROM security.account_risk o WHERE a.device_hash IS NOT NULL AND o.device_hash = a.device_hash AND o.user_id <> a.user_id) AS same_device,
              (SELECT count(*)::int FROM security.account_risk o WHERE a.email_hash IS NOT NULL AND o.email_hash = a.email_hash AND o.user_id <> a.user_id) AS same_email,
              (SELECT count(*)::int FROM social.follows f WHERE f.follower_id = a.user_id) AS following,
              (SELECT count(*)::int FROM content.posts p WHERE p.author_id = a.user_id AND p.removed_at IS NULL) AS posts,
              (SELECT count(*)::int FROM social.messages m WHERE m.sender_id = a.user_id) AS messages,
              (SELECT count(*)::int FROM social.reports r WHERE r.target_user_id = a.user_id) AS reports,
              (SELECT iu.username FROM social.referrals r JOIN identity.users iu ON iu.id = r.inviter_id WHERE r.invitee_id = a.user_id) AS invited_by
         FROM security.account_risk a JOIN identity.users u ON u.id = a.user_id
        WHERE a.state = $1 AND ($2::timestamptz IS NULL OR COALESCE(a.flagged_at, a.updated_at) < $2)
        ORDER BY COALESCE(a.flagged_at, a.updated_at) DESC LIMIT 50`,
      [state, cursor ?? null],
    );
    const items = rows.map((r) => ({
      user: {
        id: r.user_id as string,
        username: r.username as string,
        displayName: r.display_name as string,
        // Só o domínio do email (ajuda a ver padrões) e se está confirmado.
        emailDomain: String(r.email ?? '').split('@')[1] ?? null,
        emailVerified: r.email_verified as boolean,
        createdAt: r.created_at as Date,
        status: r.status as string,
      },
      score: r.score as number,
      signals: Object.entries((r.signals ?? {}) as Record<string, number>)
        .filter(([, v]) => Number(v) > 0)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([id, points]) => ({ id, label: SIGNAL_LABELS[id] ?? id, points: Number(points) })),
      state: r.state as string,
      client: r.client as string | null,
      human: r.human as boolean,
      flaggedAt: r.flagged_at as Date | null,
      limitedUntil: r.limited_until as Date | null,
      reviewedAt: r.reviewed_at as Date | null,
      reviewNote: r.review_note as string | null,
      related: { sameIp: r.same_ip as number, sameDevice: r.same_device as number, sameEmail: r.same_email as number },
      activity: { following: r.following as number, posts: r.posts as number, messages: r.messages as number, reports: r.reports as number, invitedBy: r.invited_by as string | null },
    }));
    const counts = (
      await this.pool.query(`SELECT state, count(*)::int AS n FROM security.account_risk WHERE state <> 'ok' GROUP BY state`)
    ).rows.reduce((o, r) => ({ ...o, [r.state]: r.n }), { flagged: 0, limited: 0, cleared: 0, suspended: 0 } as Record<string, number>);
    const last = rows[rows.length - 1];
    return { items, counts, nextCursor: rows.length === 50 && last ? new Date(last.flagged_at ?? last.scored_at).toISOString() : null };
  }

  async decide(staffId: string, userId: string, decision: RiskDecision, reason: string) {
    const r = (await this.pool.query('SELECT state FROM security.account_risk WHERE user_id = $1', [userId])).rows[0];
    if (!r) throw new NotFoundException('Esta conta não tem pontuação de risco');
    if (decision === 'suspend') {
      if (r.state === 'suspended') throw new BadRequestException('A conta já está suspensa');
      // A suspensão de sempre (termina as sessões, fica na auditoria como backoffice.suspend).
      await this.bo.suspend(staffId, userId, reason);
    }
    const next = decision === 'clear' ? 'cleared' : decision === 'limit' ? 'limited' : 'suspended';
    await this.pool.query(
      `UPDATE security.account_risk SET state = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4, updated_at = now(),
              limited_until = CASE WHEN $2 = 'limited' THEN now() + make_interval(days => $5) WHEN $2 = 'cleared' THEN NULL ELSE limited_until END
        WHERE user_id = $1`,
      [userId, next, staffId, reason, RISK.STAFF_LIMIT_DAYS],
    );
    await this.pool.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
      uuidv7(), staffId, `backoffice.risk_${decision}`, `user:${userId}`, { reason, from: r.state },
    ]);
    return { state: next };
  }
}

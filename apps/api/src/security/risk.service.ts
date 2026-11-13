import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import { riskFlagged } from './metrics';
import { generatedNameSignals } from './names';
import { canonicalEmail } from './net';
import { HUMAN_BONUS, RISK } from './rules';
import { ReqContext, SecurityService, tooMany } from './security.service';

type Tiers = readonly (readonly [number, number])[];
/** Os pontos de um contador com escalões ([[a partir de, pontos], …]). */
const tier = (n: number, tiers: Tiers) => tiers.reduce((p, [min, pts]) => (n >= min ? pts : p), 0);

export type RiskAction = 'follow' | 'dm' | 'gelada' | 'transfer' | 'gift';
export type RiskState = 'ok' | 'flagged' | 'cleared' | 'limited' | 'suspended';

interface RiskRow { user_id: string; score: number; signals: Record<string, number>; state: RiskState; limited_until: Date | null; watched: boolean; human: boolean }

const textHash = (s: string) => createHash('sha256').update(s.trim().toLowerCase().replace(/\s+/g, ' ')).digest('hex').slice(0, 24);

/**
 * Pontuação de risco das contas novas (0 a 100), no registo e nas primeiras 48 horas. Os sinais (ver rules.ts) somam pontos;
 * a partir de RISK.FLAG a conta vai para a fila «Contas suspeitas» do backoffice e fica 24 horas com limites mais apertados:
 * sem mensagens a quem não a segue (nem lhe escreveu), poucos «seguir» por hora, poucos pedidos de gelada e sem enviar
 * Txills. A equipa decide: confirmar como verdadeira, limitar ou suspender. As contas antigas (de antes disto) não têm
 * pontuação e nunca são limitadas aqui.
 */
@Injectable()
export class RiskService {
  private readonly log = new Logger('Risco');
  /** Contas sem pontuação (antigas): não se volta a perguntar à base de dados. */
  private readonly unscored = new Set<string>();

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly security: SecurityService,
  ) {}

  private async row(userId: string): Promise<RiskRow | null> {
    if (this.unscored.has(userId)) return null;
    const r = (
      await this.pool.query(
        `SELECT user_id, score, signals, state, limited_until, human, created_at > now() - make_interval(hours => $2) AS watched
           FROM security.account_risk WHERE user_id = $1`,
        [userId, RISK.WATCH_HOURS],
      )
    ).rows[0] as RiskRow | undefined;
    if (!r) {
      if (this.unscored.size > 100_000) this.unscored.clear();
      this.unscored.add(userId);
      return null;
    }
    return r;
  }

  /** A conta está com limites apertados agora? */
  limitedNow(r: RiskRow | null) {
    return !!r && (r.state === 'flagged' || r.state === 'limited') && !!r.limited_until && new Date(r.limited_until) > new Date();
  }

  async isLimited(userId: string) {
    return this.limitedNow(await this.row(userId));
  }

  /** O estado para outros serviços (convites): null se a conta não tem pontuação. */
  async state(userId: string): Promise<RiskState | null> {
    return (await this.row(userId))?.state ?? null;
  }

  /**
   * Junta (ou sobe) sinais e recalcula. Cada sinal guarda o máximo que já valeu. Se passar do limite e a equipa ainda não a
   * confirmou como verdadeira, marca a conta.
   */
  async addSignals(userId: string, add: Record<string, number>): Promise<RiskRow | null> {
    const entries = Object.entries(add).filter(([, v]) => v > 0);
    if (!entries.length) return this.row(userId);
    const { rows } = await this.pool.query(
      `UPDATE security.account_risk r SET signals = (
          SELECT jsonb_object_agg(k, GREATEST(COALESCE((r.signals ->> k)::int, 0), COALESCE((($2::jsonb) ->> k)::int, 0)))
            FROM (SELECT jsonb_object_keys(r.signals) AS k UNION SELECT jsonb_object_keys($2::jsonb)) keys
        ), updated_at = now()
        WHERE user_id = $1 RETURNING user_id, signals, human, state`,
      [userId, JSON.stringify(Object.fromEntries(entries))],
    );
    if (!rows[0]) return null;
    return this.rescore(userId, rows[0].signals as Record<string, number>, rows[0].human as boolean);
  }

  private async rescore(userId: string, signals: Record<string, number>, human: boolean): Promise<RiskRow | null> {
    const score = Math.max(0, Math.min(100, Object.values(signals).reduce((s, v) => s + Number(v), 0) - (human ? HUMAN_BONUS : 0)));
    const { rows } = await this.pool.query(
      // `just_flagged`: marcada neste mesmo pedido (flagged_at = now() só quando foi esta instrução a pô-lo; sem transação à volta).
      `UPDATE security.account_risk SET score = $2::int,
              state = CASE WHEN state = 'ok' AND $2::int >= $3::int THEN 'flagged' ELSE state END,
              flagged_at = CASE WHEN state = 'ok' AND $2::int >= $3::int THEN now() ELSE flagged_at END,
              limited_until = CASE WHEN state = 'ok' AND $2::int >= $3::int THEN now() + make_interval(hours => $4::int) ELSE limited_until END
        WHERE user_id = $1
        RETURNING user_id, score, signals, state, limited_until, human, true AS watched, (state = 'flagged' AND flagged_at = now()) AS just_flagged`,
      [userId, score, RISK.FLAG, RISK.LIMIT_HOURS],
    );
    const r = rows[0];
    if (r?.just_flagged) {
      riskFlagged.inc();
      void this.security.event('risk_flagged', null, userId, { score, signals });
      void this.security.audit(null, 'security.risk_flagged', `user:${userId}`, { score, signals });
    }
    return (r as RiskRow) ?? null;
  }

  /**
   * Dentro da transação do registo: a linha da conta nasce logo (sem sinais), para nenhuma réplica a tomar por conta antiga.
   */
  async seed(client: PoolClient, userId: string) {
    await client.query('INSERT INTO security.account_risk (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
  }

  /** Depois do registo (com senha, Google ou Apple): os sinais da rede, do aparelho, do email e do nome. Nunca falha o registo. */
  async onRegister(userId: string, ctx: ReqContext, p: { username: string; displayName: string; email: string; human: boolean }) {
    try {
      const emailHash = p.email && !p.email.endsWith('.invalid') ? this.security.print('email', canonicalEmail(p.email)) : null;
      const counts = (
        await this.pool.query(
          `SELECT count(*) FILTER (WHERE $2::text IS NOT NULL AND ip_hash = $2 AND created_at > now() - interval '24 hours')::int AS ip,
                  count(*) FILTER (WHERE $3::text IS NOT NULL AND net_hash = $3 AND created_at > now() - interval '24 hours')::int AS net,
                  count(*) FILTER (WHERE $4::text IS NOT NULL AND device_hash = $4 AND created_at > now() - interval '7 days')::int AS device,
                  count(*) FILTER (WHERE $5::text IS NOT NULL AND email_hash = $5)::int AS email
             FROM security.account_risk
            WHERE user_id <> $1 AND (ip_hash = $2 OR net_hash = $3 OR device_hash = $4 OR email_hash = $5)`,
          [userId, ctx.ip, ctx.net, ctx.device, emailHash],
        )
      ).rows[0];
      const names = generatedNameSignals(p.username, p.displayName, p.email);
      const P = RISK.POINTS;
      const signals: Record<string, number> = {
        mesmo_ip: tier(counts.ip, P.mesmo_ip),
        mesma_rede: tier(counts.net, P.mesma_rede),
        mesmo_aparelho: tier(counts.device, P.mesmo_aparelho),
        mesmo_email: counts.email > 0 ? P.mesmo_email : 0,
        nome_gerado: Math.min(P.nome_gerado, names.points),
        sem_prova: this.security.turnstile.enabled && !p.human && ctx.client === 'app' ? P.sem_prova : 0,
      };
      const clean = Object.fromEntries(Object.entries(signals).filter(([, v]) => v > 0));
      await this.pool.query(
        `INSERT INTO security.account_risk (user_id, signals, ip_hash, net_hash, device_hash, email_hash, client, human)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id) DO UPDATE SET signals = EXCLUDED.signals, ip_hash = EXCLUDED.ip_hash, net_hash = EXCLUDED.net_hash,
           device_hash = EXCLUDED.device_hash, email_hash = EXCLUDED.email_hash, client = EXCLUDED.client, human = EXCLUDED.human, updated_at = now()`,
        [userId, clean, ctx.ip, ctx.net, ctx.device, emailHash, ctx.client, p.human],
      );
      this.unscored.delete(userId);
      return await this.rescore(userId, clean, p.human);
    } catch (e) {
      this.log.warn(`pontuação no registo: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Uma ação de uma conta nova: conta as rajadas (só nas primeiras 48 h) e aplica os limites das contas marcadas.
   * Lança 403/429 quando a conta está limitada e a ação passa do que ela pode fazer.
   */
  async check(userId: string, action: RiskAction, p: { target?: string; text?: string } = {}) {
    const r = await this.row(userId);
    if (!r) return;
    const store = this.security.store;
    const limited = this.limitedNow(r);
    if (limited) await this.enforce(userId, action, p);
    if (!r.watched || r.state === 'cleared') return;
    const P = RISK.POINTS;
    const add: Record<string, number> = {};
    if (action === 'follow') add.rajada_seguir = tier(await store.hit(`risk:follow:${userId}`, 3600_000), P.rajada_seguir);
    if (action === 'gelada') add.rajada_geladas = tier(await store.hit(`risk:gelada:${userId}`, 3600_000), P.rajada_geladas);
    if (action === 'dm' && p.target) {
      const to = p.target.toLowerCase();
      // Pessoas diferentes: o par (eu, ela) só conta uma vez por hora.
      if ((await store.hit(`risk:dmto:${userId}:${to}`, 3600_000)) === 1) add.rajada_mensagens = tier(await store.hit(`risk:dmfan:${userId}`, 3600_000), P.rajada_mensagens);
      const text = (p.text ?? '').trim();
      if (text.length >= 8) {
        const h = textHash(text);
        if ((await store.hit(`risk:dmtxt:${userId}:${h}:${to}`, 3600_000)) === 1 && (await store.hit(`risk:dmtxt:${userId}:${h}`, 3600_000)) >= 5) add.mensagens_iguais = P.mensagens_iguais;
      }
    }
    // Só escreve quando um sinal sobe de escalão (a maioria das ações não muda nada).
    if (Object.entries(add).some(([k, v]) => v > Number(r.signals[k] ?? 0))) await this.addSignals(userId, add);
  }

  private async enforce(userId: string, action: RiskAction, p: { target?: string }) {
    const store = this.security.store;
    const deny = (msg: string) => {
      void this.security.event('risk_limited', null, userId, { action });
      return new ForbiddenException({ code: 'risk_limited', message: msg });
    };
    if (action === 'transfer' || action === 'gift') throw deny('A tua conta ainda é nova e está em revisão: por agora não pode enviar Txills. Tenta daqui a um dia.');
    if (action === 'follow' && (await store.hit(`risk:lfollow:${userId}`, 3600_000)) > RISK.LIMITED_FOLLOWS_PER_HOUR) {
      void this.security.event('risk_limited', null, userId, { action });
      throw tooMany('risk_limited', 'Estás a seguir muita gente de seguida. Espera um bocado e tenta outra vez.');
    }
    if (action === 'gelada' && (await store.hit(`risk:lgelada:${userId}`, 24 * 3600_000)) > RISK.LIMITED_GELADAS_PER_DAY) {
      void this.security.event('risk_limited', null, userId, { action });
      throw tooMany('risk_limited', 'Por hoje já chega de pedidos de gelada. Amanhã há mais.');
    }
    if (action === 'dm' && p.target) {
      const t = (
        await this.pool.query(
          `SELECT EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id AND f.followee_id = $1) AS follows_me,
                  EXISTS (SELECT 1 FROM social.conversations c JOIN social.messages m ON m.conversation_id = c.id AND m.sender_id = u.id
                           WHERE c.user_a = LEAST($1::uuid, u.id) AND c.user_b = GREATEST($1::uuid, u.id)) AS wrote_me
             FROM identity.users u WHERE lower(u.username) = lower($2)`,
          [userId, p.target],
        )
      ).rows[0];
      if (t && !t.follows_me && !t.wrote_me) throw deny('A tua conta ainda é nova: por agora só podes escrever a quem te segue ou já te escreveu.');
    }
  }
}

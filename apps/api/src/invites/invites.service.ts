import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { PushService } from '../push/push.service';
import { WalletService } from '../wallet/wallet.service';
import { INVITE, newCode } from './rules';

/**
 * Convites. O código é da pessoa; quem entra com ele fica «registada». Quando fica ativa (email confirmado e publicou algo ou segue 3 pessoas),
 * ganha Txills na hora e o prémio de quem convidou fica em espera uns dias. Tudo passa pelo livro de movimentos, de forma idempotente.
 */
@Injectable()
export class InvitesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Convites');
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly wallet: WalletService,
    private readonly push: PushService,
  ) {}

  onModuleInit() {
    if (this.config.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.sweep().catch((e) => this.log.warn(`falha: ${(e as Error).message}`)), 5 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private origin() {
    return (this.config.WEB_ORIGIN.split(',')[0] ?? '').trim().replace(/\/$/, '');
  }

  /** O código desta pessoa (cria-o na primeira vez). */
  async code(userId: string): Promise<string> {
    const got = (await this.pool.query('SELECT code FROM social.invite_codes WHERE user_id = $1', [userId])).rows[0];
    if (got) return got.code as string;
    for (let i = 0; i < 6; i++) {
      try {
        const c = newCode();
        await this.pool.query('INSERT INTO social.invite_codes (user_id, code) VALUES ($1, $2)', [userId, c]);
        return c;
      } catch (e) {
        if ((e as { code?: string }).code !== '23505') throw e;
        const again = (await this.pool.query('SELECT code FROM social.invite_codes WHERE user_id = $1', [userId])).rows[0];
        if (again) return again.code as string;
      }
    }
    throw new Error('não consegui criar o código');
  }

  /** Quem pode convidar com prémio: email confirmado e conta com mais de 3 dias. */
  private async eligible(userId: string): Promise<{ ok: boolean; reason?: string }> {
    const u = (
      await this.pool.query(
        `SELECT status, email_verified_at IS NOT NULL AS verified, created_at < now() - ($2 || ' days')::interval AS old FROM identity.users WHERE id = $1`,
        [userId, String(INVITE.MIN_AGE_DAYS)],
      )
    ).rows[0];
    if (!u || u.status !== 'active') return { ok: false, reason: 'conta inativa' };
    if (!u.verified) return { ok: false, reason: 'Confirma o teu email para os convites darem Txills.' };
    if (!u.old) return { ok: false, reason: `Os convites dão Txills a partir de ${INVITE.MIN_AGE_DAYS} dias de conta.` };
    return { ok: true };
  }

  /** O ecrã «Convida a tua malta»: código, ligação, números e regras. */
  async me(userId: string) {
    const code = await this.code(userId);
    const s = (
      await this.pool.query(
        `SELECT count(*)::int AS invited,
                count(*) FILTER (WHERE status IN ('qualified', 'paid'))::int AS active,
                count(*) FILTER (WHERE status = 'qualified')::int AS pending,
                count(*) FILTER (WHERE status = 'paid')::int AS paid,
                coalesce(sum(amount) FILTER (WHERE status = 'paid'), 0)::int AS earned,
                count(*) FILTER (WHERE qualified_at >= date_trunc('day', now()))::int AS today
           FROM social.referrals WHERE inviter_id = $1`,
        [userId],
      )
    ).rows[0];
    const el = await this.eligible(userId);
    return {
      code,
      link: `${this.origin()}/register?convite=${code}`,
      stats: s as { invited: number; active: number; pending: number; paid: number; earned: number; today: number },
      rules: { reward: INVITE.REWARD, perDay: INVITE.PER_DAY, maxPaid: INVITE.MAX_PAID, holdDays: INVITE.HOLD_DAYS },
      eligible: el.ok,
      note: el.ok ? null : (el.reason ?? null),
    };
  }

  /** Para mostrar «Convite de …» no registo (só nome e @). */
  async preview(raw: string) {
    const code = raw.trim().toUpperCase().slice(0, 20);
    const r = (
      await this.pool.query(
        `SELECT u.username, u.display_name FROM social.invite_codes c JOIN identity.users u ON u.id = c.user_id AND u.status = 'active' WHERE c.code = $1 AND c.active`,
        [code],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Convite não encontrado');
    return { username: r.username as string, displayName: r.display_name as string };
  }

  /** Txills emitidos este mês em convites (para o teto mensal). */
  private async issuedThisMonth(): Promise<number> {
    const r = await this.pool.query(
      `SELECT coalesce(sum(e.amount), 0)::bigint AS n FROM ledger.transactions t JOIN ledger.entries e ON e.transaction_id = t.id
        WHERE t.type = 'invite' AND e.amount > 0 AND t.created_at >= date_trunc('month', now())`,
    );
    return Number(r.rows[0].n);
  }

  /** Passa as pessoas convidadas ao estado seguinte. Corre de 5 em 5 minutos (e nos testes, à mão). */
  async sweep(): Promise<{ qualified: number; paid: number }> {
    let qualified = 0;
    let paid = 0;
    let budget = INVITE.MONTHLY_BUDGET - (await this.issuedThisMonth());

    // A) quem ficou ativa
    const cands = (
      await this.pool.query(
        `SELECT r.invitee_id, r.inviter_id, ui.username AS inviter_username
           FROM social.referrals r
           JOIN identity.users u ON u.id = r.invitee_id AND u.status = 'active' AND u.email_verified_at IS NOT NULL
           JOIN identity.users ui ON ui.id = r.inviter_id AND ui.status = 'active'
          WHERE r.status = 'registered'
            AND (EXISTS (SELECT 1 FROM content.posts p WHERE p.author_id = u.id AND p.removed_at IS NULL)
                 OR (SELECT count(*) FROM social.follows f WHERE f.follower_id = u.id) >= $1)
          ORDER BY r.created_at LIMIT 200`,
        [INVITE.ACTIVE_FOLLOWS],
      )
    ).rows;
    for (const c of cands) {
      const inviter = c.inviter_id as string;
      const invitee = c.invitee_id as string;
      const el = await this.eligible(inviter);
      if (!el.ok) continue; // espera que a pessoa que convidou cumpra as condições
      const counts = (
        await this.pool.query(
          `SELECT count(*) FILTER (WHERE status IN ('qualified', 'paid'))::int AS total,
                  count(*) FILTER (WHERE qualified_at >= date_trunc('day', now()))::int AS today
             FROM social.referrals WHERE inviter_id = $1`,
          [inviter],
        )
      ).rows[0];
      if (counts.total >= INVITE.MAX_PAID) {
        await this.pool.query(`UPDATE social.referrals SET status = 'blocked', reason = 'limite total' WHERE invitee_id = $1 AND status = 'registered'`, [invitee]);
        continue;
      }
      if (counts.today >= INVITE.PER_DAY) continue; // fica para amanhã
      if (budget < INVITE.REWARD * 2) continue; // teto mensal: fica para o mês seguinte
      const up = await this.pool.query(
        `UPDATE social.referrals SET status = 'qualified', qualified_at = now(), release_at = now() + ($2 || ' days')::interval WHERE invitee_id = $1 AND status = 'registered'`,
        [invitee, String(INVITE.HOLD_DAYS)],
      );
      if (!up.rowCount) continue;
      await this.wallet.credit(invitee, INVITE.REWARD, `invite:in:${invitee}`, { invite: 'in', from: c.inviter_username }, undefined, 'invite');
      budget -= INVITE.REWARD * 2;
      qualified++;
    }

    // B) libertar o prémio de quem convidou
    const due = (
      await this.pool.query(
        `SELECT r.invitee_id, r.inviter_id, u.display_name AS invitee_name
           FROM social.referrals r
           JOIN identity.users u ON u.id = r.invitee_id AND u.status = 'active'
           JOIN identity.users ui ON ui.id = r.inviter_id AND ui.status = 'active'
          WHERE r.status = 'qualified' AND r.release_at <= now() LIMIT 200`,
      )
    ).rows;
    for (const d of due) {
      await this.wallet.credit(d.inviter_id as string, INVITE.REWARD, `invite:out:${d.invitee_id}`, { invite: 'out' }, undefined, 'invite');
      await this.pool.query(`UPDATE social.referrals SET status = 'paid', paid_at = now(), amount = $2 WHERE invitee_id = $1`, [d.invitee_id, INVITE.REWARD]);
      void this.push.send(d.inviter_id as string, { title: 'Convite', body: `${d.invitee_name as string} entrou com o teu convite: +${INVITE.REWARD} Txills`, url: '/invites', tag: `invite:${d.invitee_id as string}` });
      paid++;
    }
    return { qualified, paid };
  }
}

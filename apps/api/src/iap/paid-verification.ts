import type { PoolClient } from 'pg';
import { uuidv7 } from '../common/uuid7';

/**
 * A verificação paga, ligada às compras: com uma subscrição ativa E a identidade aprovada para a verificação paga, a
 * conta fica `verified = true` e `verified_tier = 'paid'`. Ao aplicar guarda-se o selo que tinha antes; quando deixa de
 * haver subscrição ativa (expirou, reembolso, revogação), repõe-se esse selo (se antes não era verificada, deixa de ser).
 * Só se repõe se o selo ainda for o 'paid' (se a equipa entretanto mudou o selo à mão, fica o da equipa).
 *
 * Usado pelas compras (IapService) e pela aprovação do pedido como «elegível» (VerificationService), sempre dentro de
 * uma transação. Devolve o que mudou.
 */
export async function syncPaidVerification(c: PoolClient, userId: string): Promise<'applied' | 'removed' | null> {
  const pv = (await c.query('SELECT * FROM payments.paid_verification WHERE user_id = $1 FOR UPDATE', [userId])).rows[0];
  const active = (await c.query(
    `SELECT id, product_id, expires_at FROM payments.iap_purchases
      WHERE user_id = $1 AND kind = 'subscription' AND status = 'active' AND expires_at > now() ORDER BY expires_at DESC LIMIT 1`,
    [userId],
  )).rows[0] as { id: string; product_id: string; expires_at: Date } | undefined;
  const want = !!active && !!pv?.eligible_at;
  if (want && !pv.applied) {
    const u = (await c.query('SELECT verified, verified_tier FROM identity.users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
    await c.query(
      `UPDATE payments.paid_verification SET applied = true, purchase_id = $2, previous_verified = $3, previous_tier = $4, applied_at = now(), updated_at = now() WHERE user_id = $1`,
      [userId, active.id, !!u?.verified, u?.verified ? (u.verified_tier ?? 'verified') : null],
    );
    await c.query(`UPDATE identity.users SET verified = true, verified_tier = 'paid', verified_at = CASE WHEN verified THEN verified_at ELSE now() END WHERE id = $1`, [userId]);
    await c.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
      uuidv7(), null, 'iap.verification_applied', `user:${userId}`, { purchaseId: active.id, productId: active.product_id, previousTier: u?.verified ? (u.verified_tier ?? 'verified') : null },
    ]);
    // A própria pessoa vê o aviso «foste verificado» (o mesmo da aprovação do pedido).
    await c.query(`INSERT INTO social.notifications (id, user_id, actor_id, kind, data) VALUES ($1, $2, $2, 'verified', $3)`, [uuidv7(), userId, { tier: 'paid' }]);
    return 'applied';
  }
  if (want && pv.applied && pv.purchase_id !== active.id) {
    await c.query('UPDATE payments.paid_verification SET purchase_id = $2, updated_at = now() WHERE user_id = $1', [userId, active.id]);
    return null;
  }
  if (!want && pv?.applied) {
    const prevVerified = !!pv.previous_verified;
    const prevTier = prevVerified ? ((pv.previous_tier as string | null) ?? 'verified') : null;
    await c.query(`UPDATE identity.users SET verified = $2, verified_tier = $3 WHERE id = $1 AND verified_tier = 'paid'`, [userId, prevVerified, prevTier]);
    await c.query('UPDATE payments.paid_verification SET applied = false, purchase_id = NULL, updated_at = now() WHERE user_id = $1', [userId]);
    await c.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
      uuidv7(), null, 'iap.verification_removed', `user:${userId}`, { restoredTier: prevTier, purchaseId: pv.purchase_id ?? null },
    ]);
    return 'removed';
  }
  return null;
}

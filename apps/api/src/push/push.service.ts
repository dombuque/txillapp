import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import webpush from 'web-push';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';

export interface PushPayload {
  title: string;
  body: string;
  /** Caminho dentro da app que abre ao tocar na notificação. */
  url: string;
  /** Mesmo `tag` substitui a notificação anterior (por exemplo, várias mensagens da mesma pessoa). */
  tag?: string;
}

/**
 * Notificações no telemóvel (Web Push). O texto nunca inclui o conteúdo de mensagens ou comentários:
 * o ecrã de bloqueio é público.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger('Push');
  readonly enabled: boolean;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.enabled = !!(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);
    if (this.enabled) webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY!, config.VAPID_PRIVATE_KEY!);
  }

  publicKey() {
    return { publicKey: this.enabled ? this.config.VAPID_PUBLIC_KEY! : null };
  }

  async subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    // O mesmo aparelho pode mudar de conta: o endpoint passa para quem o registou por último.
    await this.pool.query(
      `INSERT INTO social.push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [uuidv7(), userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth],
    );
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.pool.query('DELETE FROM social.push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]);
  }

  /** Envia para todos os aparelhos da pessoa. Nunca falha a acção principal; subscrições mortas são removidas. */
  async send(userId: string, payload: PushPayload): Promise<void> {
    if (!this.enabled) return;
    try {
      const { rows } = await this.pool.query('SELECT endpoint, p256dh, auth FROM social.push_subscriptions WHERE user_id = $1', [userId]);
      await Promise.all(
        rows.map(async (r) => {
          try {
            await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, JSON.stringify(payload), { TTL: 86_400, urgency: 'high' });
          } catch (e) {
            const status = (e as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) await this.pool.query('DELETE FROM social.push_subscriptions WHERE endpoint = $1', [r.endpoint]);
            else this.log.warn(`falha no push (${status ?? 'sem estado'})`);
          }
        }),
      );
    } catch (e) {
      this.log.warn(`falha no push: ${(e as Error).message}`);
    }
  }
}

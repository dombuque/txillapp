import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import webpush from 'web-push';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { ApnsSender, apnsOptionsFromEnv, nativeRoute } from './apns';
import { FcmSender, type FcmPush } from './fcm';

/** O que a pessoa pode ligar ou desligar nas notificações. */
// `comeback`: os lembretes quando a pessoa não passa por cá (push e e-mail, ver src/reminders/comeback-reminder.service.ts);
// esses não entram na lista de notificações.
// `gelada`: a «Sexta da gelada», o aviso de sexta à tarde (ver src/gelada/gelada-friday.service.ts); também não entra na lista.
export const NOTIFY_CATEGORIES = ['messages', 'follows', 'comments', 'mentions', 'reposts', 'gifts', 'reactions', 'invites', 'calls', 'venues', 'comeback', 'remixes', 'gelada'] as const;
export type NotifyCategory = (typeof NOTIFY_CATEGORIES)[number];

export interface PushPayload extends FcmPush {
  /** A que categoria pertence (se a pessoa a desligou, não se envia). */
  category?: NotifyCategory;
  title: string;
  body: string;
  /** Caminho dentro da app que abre ao tocar na notificação. */
  url: string;
  /** Mesmo `tag` substitui a notificação anterior (por exemplo, várias mensagens da mesma pessoa). */
  tag?: string;
  /** Só Web Push: não vai para a app nativa (ex.: reenvios do aviso de chamada, fechar a notificação da chamada). */
  webOnly?: boolean;
  /** Dados extra só para o browser (a mensagem para a app nativa fica igual). */
  webData?: Record<string, string>;
}

/** O que vai para o browser (Web Push): os dados extra (ex.: kind, callId, from, video) ficam ao nível de cima, ao lado do título e do texto. */
export function webPushBody(p: PushPayload): string {
  return JSON.stringify({ ...(p.data ?? {}), ...(p.webData ?? {}), title: p.title, body: p.body, url: p.url, tag: p.tag });
}

/** O aviso de APNs desligado só aparece uma vez por processo. */
let apnsWarned = false;

/**
 * Notificações no telemóvel: app Android (FCM), app no iPhone (APNs, direto à Apple) e browser (Web Push). O texto nunca
 * inclui o conteúdo de mensagens ou comentários: o ecrã de bloqueio é público.
 */
@Injectable()
export class PushService implements OnModuleDestroy {
  private readonly log = new Logger('Push');
  readonly enabled: boolean;
  private readonly fcm: FcmSender;
  private readonly apns: ApnsSender;
  private readonly web: boolean;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.fcm = new FcmSender(config.FCM_SERVICE_ACCOUNT_JSON);
    const apns = apnsOptionsFromEnv(config);
    this.apns = new ApnsSender(apns.options);
    if (!apns.options && !apnsWarned && config.NODE_ENV !== 'test') {
      apnsWarned = true;
      this.log.warn(`APNs desligado (${apns.problem}): as notificações não chegam à app no iPhone. Ver docs/lojas/apns.md`);
    }
    this.web = !!(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);
    this.enabled = this.web || this.fcm.enabled || this.apns.enabled;
    if (this.web) webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY!, config.VAPID_PRIVATE_KEY!);
  }

  onModuleDestroy() {
    this.apns.close();
  }

  /** As categorias que a pessoa desligou. */
  async off(userId: string): Promise<NotifyCategory[]> {
    const r = await this.pool.query('SELECT off FROM social.notification_prefs WHERE user_id = $1', [userId]);
    return ((r.rows[0]?.off as string[] | undefined) ?? []).filter((c): c is NotifyCategory => (NOTIFY_CATEGORIES as readonly string[]).includes(c));
  }

  async setOff(userId: string, off: NotifyCategory[]) {
    await this.pool.query(
      `INSERT INTO social.notification_prefs (user_id, off) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET off = EXCLUDED.off, updated_at = now()`,
      [userId, [...new Set(off)]],
    );
  }

  publicKey() {
    return { publicKey: this.config.VAPID_PUBLIC_KEY && this.config.VAPID_PRIVATE_KEY ? this.config.VAPID_PUBLIC_KEY : null };
  }

  /** App nativa: guarda o código do aparelho (FCM no Android, APNs no iPhone) desta conta. O mesmo aparelho pode mudar de conta. */
  async registerDevice(userId: string, token: string, platform: 'android' | 'ios') {
    await this.pool.query(
      `INSERT INTO social.push_devices (token, user_id, platform) VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now()`,
      [token, userId, platform],
    );
  }

  async removeDevice(userId: string, token: string) {
    await this.pool.query('DELETE FROM social.push_devices WHERE user_id = $1 AND token = $2', [userId, token]);
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

  /**
   * Envia para todos os aparelhos da pessoa. Nunca falha a acção principal; subscrições mortas são removidas.
   * Devolve a quantos aparelhos chegou (0 = nenhum push válido: os lembretes de regresso passam então ao e-mail).
   */
  async send(userId: string, payload: PushPayload): Promise<number> {
    if (!this.enabled) return 0;
    let delivered = 0;
    try {
      if (payload.category && (await this.off(userId)).includes(payload.category)) return 0;
      if ((this.fcm.enabled || this.apns.enabled) && !payload.webOnly) {
        const devices = (await this.pool.query('SELECT token, platform FROM social.push_devices WHERE user_id = $1', [userId])).rows;
        await Promise.all(
          devices.map(async (d) => {
            const token = d.token as string;
            const platform = d.platform === 'ios' ? 'ios' : 'android';
            // iPhone com código APNs vai à Apple (o FCM não o aceita e apagava o aparelho); Android (e iPhone com código FCM) ao FCM.
            const route = nativeRoute(platform, token);
            if (route === 'apns' ? !this.apns.enabled : !this.fcm.enabled) return; // sem configuração: fica guardado, não se apaga
            try {
              const r = route === 'apns' ? await this.apns.send(token, payload) : await this.fcm.send(token, payload, platform);
              if (r === 'dead') await this.pool.query('DELETE FROM social.push_devices WHERE token = $1', [token]);
              else if (r === 'error' && route === 'fcm') this.log.warn('falha no push nativo');
              else if (r === 'ok') delivered++;
            } catch (e) {
              this.log.warn(`falha no push nativo: ${(e as Error).message}`);
            }
          }),
        );
      }
      if (!this.web) return delivered;
      const { rows } = await this.pool.query('SELECT endpoint, p256dh, auth FROM social.push_subscriptions WHERE user_id = $1', [userId]);
      await Promise.all(
        rows.map(async (r) => {
          try {
            await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, webPushBody(payload), { TTL: payload.ttlSeconds ?? 86_400, urgency: 'high' });
            delivered++;
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
    return delivered;
  }
}

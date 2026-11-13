import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { PushService } from '../push/push.service';
import { blockedBetween } from '../social/visibility';
import { adultSql } from './gelada-cards';

/** De quanto em quanto tempo a tarefa corre (a mesma cadência dos lembretes de regresso). */
export const FRIDAY_EVERY_MS = 3_600_000;
/** Quantas pessoas, no máximo, em cada volta. */
export const FRIDAY_BATCH = 500;
/** A janela da sexta, em horas de Maputo: das 17h00 às 18h59 (a tarefa corre de hora a hora: apanha sempre uma volta). */
export const FRIDAY_FROM_HOUR = 17;
export const FRIDAY_TO_HOUR = 19;
/** «Amigos ativos»: seguidores mútuos que abriram a app nos últimos 7 dias. */
const ACTIVE_DAYS = 7;

/** A hora de Maputo (UTC+2, sem hora de verão). */
export function maputo(now: Date) {
  const t = new Date(now.getTime() + 2 * 3_600_000);
  return { day: t.getUTCDay(), hour: t.getUTCHours(), date: t.toISOString().slice(0, 10) };
}
export const isFridayWindow = (now: Date) => {
  const m = maputo(now);
  return m.day === 5 && m.hour >= FRIDAY_FROM_HOUR && m.hour < FRIDAY_TO_HOUR;
};

/** A linha de moderação do fim (curta, sem sermão). */
export const MODERATION = { adult: 'Bebe com moderação 🙌', minor: 'Com calma e boa sexta 🙌' };

/**
 * O texto do aviso: cobrar a dívida mais antiga («É sexta 🍻 O @januario ainda te deve uma. Cobra-lhe!») ou pedir à malta.
 * Para menores, a versão refresco, sem álcool no texto. Termina sempre com a linha de moderação.
 */
export function fridayMessage(f: { adult: boolean; debtor?: { username: string; article: 'O' | 'A' | null } | null }) {
  const cheers = f.adult ? '🍻' : '🥤';
  const what = f.debtor
    ? `${f.debtor.article ? `${f.debtor.article} ` : ''}@${f.debtor.username} ainda te deve ${f.adult ? 'uma' : 'um refresco'}. Cobra-lhe!`
    : f.adult ? 'Pede uma gelada à malta.' : 'Pede um refresco à malta.';
  return {
    title: f.adult ? 'Sexta da gelada' : 'É sexta!',
    body: `É sexta ${cheers} ${what} ${f.adult ? MODERATION.adult : MODERATION.minor}`,
    url: f.debtor ? '/geladas' : '/geladas?pedir=1',
    kind: (f.debtor ? 'debt' : 'friends') as 'debt' | 'friends',
  };
}

export interface FridayRunResult { sent: number; outside: boolean }

/**
 * «Sexta da gelada»: à sexta, por volta das 17h de Maputo, um aviso no telemóvel a quem tem dívidas por cobrar ou amigos
 * ativos. No máximo um por sexta (taste.gelada_fridays, com chave pessoa + dia: duas voltas ao mesmo tempo não mandam dois),
 * com a categoria própria («Sexta da gelada», `gelada`) que se pode desligar. Menores recebem a versão refresco.
 * Usa o mesmo mecanismo dos lembretes de regresso (um temporizador de hora a hora; nos testes chama-se `run()`).
 */
@Injectable()
export class GeladaFridayService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SextaDaGelada');
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly push: PushService,
  ) {}

  onModuleInit() {
    if (this.config.NODE_ENV === 'test') return;
    const tick = () => void this.run().catch((e) => this.log.warn(`falha na sexta da gelada: ${(e as Error).message}`));
    this.timer = setInterval(tick, FRIDAY_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(opts: { now?: Date; onlyUsers?: string[]; limit?: number } = {}): Promise<FridayRunResult> {
    const now = opts.now ?? new Date();
    await this.pool.query(`DELETE FROM taste.gelada_fridays WHERE friday < ($1::timestamptz AT TIME ZONE 'Africa/Maputo')::date - 90`, [now]);
    // Uma reserva que ficou a meio (o processo caiu) não chegou a ninguém: sai ao fim de uma hora.
    await this.pool.query(`DELETE FROM taste.gelada_fridays WHERE kind = 'pending' AND sent_at < $1::timestamptz - interval '1 hour'`, [now]);
    if (!isFridayWindow(now)) return { sent: 0, outside: true };
    if (!this.push.enabled) return { sent: 0, outside: false };
    const friday = maputo(now).date;
    const { rows } = await this.pool.query(
      `SELECT u.id, ${adultSql('u')} AS adult,
              (SELECT json_build_object('username', du.username, 'gender', CASE WHEN du.show_gender THEN du.gender END)
                 FROM taste.gelada_debts d JOIN identity.users du ON du.id = d.debtor_id
                WHERE d.creditor_id = u.id AND d.status = 'open' AND du.status = 'active' AND NOT ${blockedBetween('du.id', 'u.id')}
                ORDER BY d.created_at LIMIT 1) AS debtor,
              EXISTS (SELECT 1 FROM social.follows a JOIN social.follows b ON b.follower_id = a.followee_id AND b.followee_id = a.follower_id
                        JOIN identity.users fu ON fu.id = a.followee_id
                       WHERE a.follower_id = u.id AND fu.status = 'active' AND fu.last_seen_at > $1::timestamptz - make_interval(days => $4)) AS friends
         FROM identity.users u
        WHERE u.status = 'active'
          AND ($2::uuid[] IS NULL OR u.id = ANY ($2::uuid[]))
          AND NOT EXISTS (SELECT 1 FROM social.notification_prefs np WHERE np.user_id = u.id AND 'gelada' = ANY (np.off))
          AND NOT EXISTS (SELECT 1 FROM taste.gelada_fridays gf WHERE gf.user_id = u.id AND gf.friday = $3::date)
          AND (EXISTS (SELECT 1 FROM social.push_devices pd WHERE pd.user_id = u.id) OR EXISTS (SELECT 1 FROM social.push_subscriptions ps WHERE ps.user_id = u.id))
        ORDER BY u.id LIMIT $5`,
      [now, opts.onlyUsers ?? null, friday, ACTIVE_DAYS, opts.limit ?? FRIDAY_BATCH],
    );
    let sent = 0;
    for (const r of rows) {
      const d = r.debtor as { username: string; gender: string | null } | null;
      if (!d && !r.friends) continue;
      try {
        const claim = await this.pool.query(`INSERT INTO taste.gelada_fridays (user_id, friday, kind, sent_at) VALUES ($1, $2, 'pending', $3) ON CONFLICT DO NOTHING`, [r.id, friday, now]);
        if (!claim.rowCount) continue; // outra volta já lhe pegou
        const msg = fridayMessage({ adult: !!r.adult, debtor: d ? { username: d.username, article: d.gender === 'female' ? 'A' : d.gender === 'male' ? 'O' : null } : null });
        const delivered = await this.push.send(r.id as string, { title: msg.title, body: msg.body, url: msg.url, tag: 'gelada-friday', category: 'gelada', ttlSeconds: 4 * 3600 });
        if (delivered > 0) {
          await this.pool.query('UPDATE taste.gelada_fridays SET kind = $3 WHERE user_id = $1 AND friday = $2', [r.id, friday, msg.kind]);
          sent++;
        } else {
          // Não chegou a lado nenhum: não conta (tenta-se na volta seguinte, se ainda for a hora).
          await this.pool.query('DELETE FROM taste.gelada_fridays WHERE user_id = $1 AND friday = $2', [r.id, friday]);
        }
      } catch (e) {
        this.log.warn(`aviso da sexta falhou: ${(e as Error).message}`);
      }
    }
    return { sent, outside: false };
  }
}

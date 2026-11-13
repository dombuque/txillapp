import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Scheduler } from '../realtime/scheduler';
import { Pool } from 'pg';
import { AuthService } from '../auth/auth.service';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { MailService } from '../mail/mail.service';
import { PushService } from '../push/push.service';

/** Dias depois de criar a conta em que se lembra (1.º, 2.º e 3.º lembrete). Depois disso não se insiste mais. */
export const REMIND_AFTER_DAYS = [1, 3, 7] as const;

/**
 * Lembra quem ainda não ativou a conta (e-mail por confirmar): manda um e-mail com um link novo e, se tiver a app
 * com notificações, um aviso no telemóvel. No máximo três vezes. Corre de hora a hora; os testes chamam `run()` à mão.
 */
@Injectable()
export class VerifyReminderService implements OnModuleInit {
  private readonly log = new Logger('VerifyReminder');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly push: PushService,
    private readonly scheduler: Scheduler,
  ) {}

  onModuleInit() {
    this.scheduler.every('reminders.verify', 3_600_000, () => this.run());
  }

  async run(limit = 200): Promise<number> {
    if (!this.mail.enabled) return 0;
    const { rows } = await this.pool.query(
      `SELECT id FROM identity.users
        WHERE status = 'active' AND email_verified_at IS NULL AND email NOT LIKE '%@invalid.local'
          AND verify_reminders < 3
          AND created_at < now() - make_interval(days => (ARRAY[$1, $2, $3]::int[])[verify_reminders + 1])
          AND (verify_reminded_at IS NULL OR verify_reminded_at < now() - interval '44 hours')
        ORDER BY created_at LIMIT $4`,
      [...REMIND_AFTER_DAYS, limit],
    );
    let sent = 0;
    for (const r of rows) {
      const id = r.id as string;
      // Contas antigas (de antes deste lembrete) também recebem, com pelo menos ~2 dias entre lembretes.
      // Marca primeiro: se o envio falhar, não se tenta de novo em ciclo (o próximo lembrete chega no dia certo).
      await this.pool.query('UPDATE identity.users SET verify_reminders = verify_reminders + 1, verify_reminded_at = now() WHERE id = $1', [id]);
      const ok = await this.auth.sendVerification(id).catch(() => false);
      if (ok) sent++;
      void this.push.send(id, {
        title: 'Ativa a tua conta',
        body: 'Falta só confirmares o e-mail para publicar, comentar e conversar. Enviámos-te um link novo.',
        url: '/',
        tag: 'verify-email',
      });
    }
    return sent;
  }
}

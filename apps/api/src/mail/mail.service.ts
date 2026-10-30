import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { AppConfig, CONFIG } from '../config';
import type { Mail } from './templates';

export interface SentMail extends Mail {
  to: string;
}

/**
 * Envio de e-mail por SMTP (Zoho, Resend, etc.). Sem SMTP_USER/SMTP_PASS fica desligado: a app funciona na mesma,
 * só não pede confirmação de e-mail nem envia recuperação de senha. Em testes (MAIL_CAPTURE) guarda em memória.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  readonly enabled: boolean;
  readonly publicUrl: string;
  /** Só em modo de captura (testes). */
  readonly outbox: SentMail[] = [];
  private readonly capture: boolean;
  private readonly from: string;
  private transport?: Transporter;

  constructor(@Inject(CONFIG) cfg: AppConfig) {
    this.capture = cfg.MAIL_CAPTURE === 'true';
    this.enabled = this.capture || !!(cfg.SMTP_USER && cfg.SMTP_PASS);
    this.publicUrl = cfg.PUBLIC_URL.replace(/\/$/, '');
    this.from = cfg.MAIL_FROM;
    if (this.enabled && !this.capture) {
      this.transport = createTransport({
        host: cfg.SMTP_HOST,
        port: cfg.SMTP_PORT,
        secure: cfg.SMTP_PORT === 465,
        auth: { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS },
      });
    }
  }

  /** Nunca lança: um e-mail que falha não pode deitar abaixo o registo nem o pedido. Devolve se foi entregue ao servidor de e-mail. */
  async send(mail: SentMail): Promise<boolean> {
    if (!this.enabled) return false;
    if (this.capture) {
      this.outbox.push(mail);
      return true;
    }
    try {
      await this.transport!.sendMail({ from: this.from, ...mail });
      return true;
    } catch (e) {
      this.log.error(`Falha ao enviar e-mail: ${(e as Error).message}`);
      return false;
    }
  }
}

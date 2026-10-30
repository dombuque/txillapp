import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { MailService } from './mail.service';

/** Publicar, comentar, conversar e presentear exigem o e-mail confirmado (só quando o envio de e-mail está ligado). */
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly mail: MailService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    if (!this.mail.enabled) return true;
    const req = ctx.switchToHttp().getRequest<{ userId?: string }>();
    const { rows } = await this.pool.query('SELECT email_verified_at IS NOT NULL AS ok FROM identity.users WHERE id = $1', [req.userId]);
    if (rows[0]?.ok) return true;
    throw new ForbiddenException({ code: 'email_not_verified', message: 'Confirma o teu e-mail para fazeres isto. Enviámos-te um link.' });
  }
}

export const NeedsVerifiedEmail = () => UseGuards(VerifiedEmailGuard);

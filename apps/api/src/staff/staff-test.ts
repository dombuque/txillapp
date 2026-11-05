import { INestApplication } from '@nestjs/common';
import { StaffAuthService } from './staff-auth.service';
import { totp } from './totp';

/** Para os testes: cria uma conta de equipa já configurada (senha + dois passos) e devolve a sessão. */
export async function staffLogin(app: INestApplication, name: string, teams: string[] = ['administracao']) {
  const svc = app.get(StaffAuthService);
  const email = `${name}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@equipa.test`;
  const inv = await svc.invite(null, { email, name, teams });
  const token = new URL(inv.setupUrl).searchParams.get('token')!;
  const info = await svc.setupInfo(token);
  const done = await svc.setupComplete(token, 'senha-da-equipa-bem-longa', totp(info.secret));
  const userId = (await svc.authenticate(done.token)).userId;
  return { userId, token: done.token, email, accountId: inv.accountId, password: 'senha-da-equipa-bem-longa', secret: info.secret };
}

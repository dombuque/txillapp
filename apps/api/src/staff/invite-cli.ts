/**
 * Convida uma conta de equipa a partir do servidor (para a primeira conta, antes de haver quem convide):
 *   node dist/staff/invite-cli.js email@exemplo.com "Nome" administracao[,moderacao]
 * Escreve a ligação de uso único (1 hora) para a pessoa definir a SENHA e os dois passos no browser:
 * a senha nunca passa por aqui.
 */
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { StaffAuthService } from './staff-auth.service';

async function main() {
  const [email, name, teamsArg] = process.argv.slice(2);
  if (!email || !name) throw new Error('Uso: invite-cli <email> <nome> [equipas separadas por vírgula, por omissão administracao]');
  const config = loadConfig(process.env);
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  try {
    const svc = new StaffAuthService(pool, config);
    const r = await svc.invite(null, { email, name, teams: (teamsArg ?? 'administracao').split(',').map((t) => t.trim()).filter(Boolean) });
    console.log(`Ligação de configuração (válida ${r.expiresInMinutes} minutos, uso único):\n${r.setupUrl}`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});

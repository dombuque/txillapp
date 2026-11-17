import { ForbiddenException } from '@nestjs/common';
import type { Pool } from 'pg';

/**
 * Quem pode abrir (e agendar) uma Txillada: conta ativa, 18 anos ou mais (sem data de nascimento = não), sem suspensão.
 * Senão 403 com a razão. Devolve o @ e o nome (para o token do LiveKit).
 */
export async function assertCanHost(pool: Pool, me: string): Promise<{ username: string; display_name: string }> {
  const u = (
    await pool.query(
      `SELECT status, username, display_name, birth_date IS NOT NULL AS has_birth,
              COALESCE(birth_date <= (current_date - interval '18 years'), false) AS adult
         FROM identity.users WHERE id = $1`,
      [me],
    )
  ).rows[0];
  if (!u || u.status !== 'active') throw new ForbiddenException('A tua conta não pode abrir uma Txillada.');
  if (!u.has_birth) throw new ForbiddenException('A Txillada é só para maiores de 18 anos e a tua conta não tem a data de nascimento. Escreve para suporte@txillapp.com para a acrescentares.');
  if (!u.adult) throw new ForbiddenException('A Txillada é só para maiores de 18 anos.');
  return u;
}

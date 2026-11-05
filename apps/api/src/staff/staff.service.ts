import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';

/** Tudo o que a equipa pode fazer no backoffice. */
export const PERMISSIONS = [
  'users.view', 'users.notes', 'users.verify_email', 'users.suspend',
  'reports.read', 'reports.decide',
  'verification.decide',
  'catalog.manage',
  'wallet.view', 'invites.view', 'stats.view', 'audit.read',
  'staff.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface TeamDef { id: string; name: string; description: string; permissions: readonly Permission[] }

/** As equipas e o que cada uma pode fazer. A Administração pode tudo. */
export const TEAMS: readonly TeamDef[] = [
  { id: 'administracao', name: 'Administração', description: 'Tudo, incluindo gerir a equipa.', permissions: PERMISSIONS },
  { id: 'moderacao', name: 'Moderação', description: 'Queixas e conteúdo; suspender contas e gerir o catálogo.', permissions: ['users.view', 'users.notes', 'users.suspend', 'reports.read', 'reports.decide', 'catalog.manage'] },
  { id: 'suporte', name: 'Suporte', description: 'Ajudar utilizadores: ver contas, confirmar emails, deixar notas.', permissions: ['users.view', 'users.notes', 'users.verify_email'] },
  { id: 'verificacao', name: 'Verificação', description: 'Decidir os pedidos de selo.', permissions: ['users.view', 'verification.decide'] },
  { id: 'financas', name: 'Finanças', description: 'Ver Txills, pedidos e números.', permissions: ['users.view', 'wallet.view', 'stats.view'] },
  { id: 'crescimento', name: 'Crescimento e parceiros', description: 'Convites, números e parceiros.', permissions: ['users.view', 'invites.view', 'stats.view'] },
  { id: 'auditoria', name: 'Auditoria', description: 'Só leitura: contas, números e o registo.', permissions: ['users.view', 'audit.read', 'stats.view'] },
];
const TEAM_IDS = new Set(TEAMS.map((t) => t.id));

@Injectable()
export class StaffService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Permissões de uma conta: a Administração (is_admin) tem todas; as outras vêm das equipas. */
  async permissions(userId: string): Promise<Set<Permission>> {
    const r = (
      await this.pool.query(
        `SELECT u.is_admin, coalesce(m.teams, '{}') AS teams, coalesce(m.active, false) AS active
           FROM identity.users u LEFT JOIN identity.staff_members m ON m.user_id = u.id WHERE u.id = $1 AND u.status IN ('active', 'staff')`,
        [userId],
      )
    ).rows[0];
    const out = new Set<Permission>();
    if (!r) return out;
    if (r.is_admin) return new Set(PERMISSIONS);
    if (!r.active) return out;
    for (const t of r.teams as string[]) for (const p of TEAMS.find((x) => x.id === t)?.permissions ?? []) out.add(p);
    return out;
  }

  async me(userId: string) {
    const perms = await this.permissions(userId);
    const r = (await this.pool.query('SELECT u.is_admin, coalesce(m.teams, \'{}\') AS teams FROM identity.users u LEFT JOIN identity.staff_members m ON m.user_id = u.id WHERE u.id = $1', [userId])).rows[0];
    const teams = new Set<string>(r?.teams ?? []);
    if (r?.is_admin) teams.add('administracao');
    return { teams: [...teams], permissions: [...perms], catalog: TEAMS.map((t) => ({ id: t.id, name: t.name, description: t.description })) };
  }

  private async audit(actor: string, action: string, target: string, metadata: Record<string, unknown>) {
    await this.pool.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), actor, action, target, metadata]);
  }

  private cleanTeams(teams: string[]): string[] {
    const t = [...new Set(teams)];
    if (!t.length) throw new BadRequestException('Escolhe pelo menos uma equipa');
    if (t.some((x) => !TEAM_IDS.has(x))) throw new BadRequestException('Equipa desconhecida');
    return t;
  }

  /** A equipa: quem tem acesso e a que equipas pertence. */
  async list() {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.username, u.display_name, u.email, u.is_admin, coalesce(m.teams, '{}') AS teams, coalesce(m.active, u.is_admin) AS active, m.created_at AS added_at,
              (SELECT max(s.created_at) FROM identity.sessions s WHERE s.user_id = u.id) AS last_seen
         FROM identity.users u LEFT JOIN identity.staff_members m ON m.user_id = u.id
        WHERE u.status = 'active' AND (u.is_admin OR m.user_id IS NOT NULL)
        ORDER BY u.is_admin DESC, u.username`,
    );
    return rows.map((r) => {
      const teams = new Set<string>(r.teams as string[]);
      if (r.is_admin) teams.add('administracao');
      return { id: r.id as string, username: r.username as string, displayName: r.display_name as string, email: r.email as string, teams: [...teams], active: r.active as boolean, lastSeen: (r.last_seen as string | null) ?? null };
    });
  }

  private async adminCount(): Promise<number> {
    return (await this.pool.query(`SELECT count(*)::int AS n FROM identity.users WHERE is_admin AND status = 'active'`)).rows[0].n as number;
  }

  /** Dá acesso a uma conta (ou muda as equipas dela). */
  async setTeams(actor: string, username: string, teamsIn: string[], reason: string) {
    const teams = this.cleanTeams(teamsIn);
    const u = (await this.pool.query(`SELECT id, is_admin FROM identity.users WHERE lower(username) = lower($1) AND status = 'active'`, [username.replace(/^@/, '')])).rows[0];
    if (!u) throw new NotFoundException('Conta não encontrada');
    const willAdmin = teams.includes('administracao');
    if (u.is_admin && !willAdmin && (await this.adminCount()) <= 1) throw new ForbiddenException('Tem de ficar pelo menos uma pessoa na Administração');
    const others = teams.filter((t) => t !== 'administracao');
    await this.pool.query(
      `INSERT INTO identity.staff_members (user_id, teams, active, added_by) VALUES ($1, $2, true, $3)
       ON CONFLICT (user_id) DO UPDATE SET teams = $2, active = true, updated_at = now()`,
      [u.id, others, actor],
    );
    await this.pool.query('UPDATE identity.users SET is_admin = $2 WHERE id = $1', [u.id, willAdmin]);
    await this.audit(actor, 'staff.set_teams', `user:${u.id}`, { teams, reason });
  }

  /** Tira o acesso à equipa. */
  async remove(actor: string, userId: string, reason: string) {
    const u = (await this.pool.query('SELECT id, is_admin FROM identity.users WHERE id = $1', [userId])).rows[0];
    if (!u) throw new NotFoundException('Conta não encontrada');
    if (userId === actor) throw new ForbiddenException('Não podes tirar o teu próprio acesso');
    if (u.is_admin && (await this.adminCount()) <= 1) throw new ForbiddenException('Tem de ficar pelo menos uma pessoa na Administração');
    await this.pool.query('UPDATE identity.staff_members SET active = false, updated_at = now() WHERE user_id = $1', [userId]);
    await this.pool.query('UPDATE identity.users SET is_admin = false WHERE id = $1', [userId]);
    await this.audit(actor, 'staff.remove', `user:${userId}`, { reason });
  }
}

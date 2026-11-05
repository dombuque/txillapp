import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { TEAMS } from './staff.service';
import { newSecret, otpauthUrl, seal, unseal, verifyTotp } from './totp';

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const SESSION_HOURS = 8;
const SETUP_MINUTES = 60;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const TEAM_IDS = new Set(TEAMS.map((t) => t.id));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export interface StaffSession { accountId: string; userId: string }

/**
 * Contas de equipa do backoffice: separadas da rede social. Login com email, senha e código dos dois passos; sessão curta (8 h)
 * com um tipo de sessão próprio (as sessões da rede não servem aqui, nem as daqui na rede).
 */
@Injectable()
export class StaffAuthService {
  private readonly secret: Uint8Array;
  private readonly appSecret: string;
  private dummyHash: Promise<string>;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.appSecret = config.JWT_ACCESS_SECRET;
    this.secret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
    // Para a resposta demorar o mesmo com ou sem conta (não se descobre que emails existem).
    this.dummyHash = argon2.hash('nao-e-uma-senha-real', ARGON_OPTS);
  }

  private adminUrl() {
    return (this.config.ADMIN_URL ?? this.config.PUBLIC_URL).replace(/\/$/, '');
  }

  private async audit(actor: string | null, action: string, target: string, metadata: Record<string, unknown> = {}) {
    await this.pool.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), actor, action, target, metadata]);
  }

  private cleanTeams(teams: string[]): string[] {
    const t = [...new Set(teams)];
    if (!t.length) throw new BadRequestException('Escolhe pelo menos uma equipa');
    if (t.some((x) => !TEAM_IDS.has(x))) throw new BadRequestException('Equipa desconhecida');
    return t;
  }

  private async sign(account: { id: string; token_version: number }) {
    return new SignJWT({ tv: account.token_version })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(account.id)
      .setIssuer('txillapp')
      .setAudience('staff')
      .setIssuedAt()
      .setExpirationTime(`${SESSION_HOURS}h`)
      .sign(this.secret);
  }

  /** Para o guard: a sessão de equipa (e só essa) → a conta e a identidade interna. */
  async authenticate(token: string): Promise<StaffSession> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { algorithms: ['HS256'], issuer: 'txillapp', audience: 'staff' });
      const a = (await this.pool.query('SELECT id, user_id, token_version, active FROM identity.staff_accounts WHERE id = $1', [payload.sub])).rows[0];
      if (!a || !a.active || a.token_version !== payload.tv) throw new Error('sessão inválida');
      return { accountId: a.id as string, userId: a.user_id as string };
    } catch {
      throw new UnauthorizedException();
    }
  }

  private newLink(token: string) {
    return `${this.adminUrl()}/backoffice/setup?token=${token}`;
  }

  private async issueSetupToken(accountId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.pool.query('DELETE FROM identity.staff_setup_tokens WHERE account_id = $1', [accountId]);
    await this.pool.query("INSERT INTO identity.staff_setup_tokens (token_hash, account_id, expires_at) VALUES ($1, $2, now() + ($3 || ' minutes')::interval)", [sha(token), accountId, String(SETUP_MINUTES)]);
    return token;
  }

  /** Cria a conta de equipa (sem senha) e devolve a ligação de uso único para a pessoa definir a senha e os dois passos. */
  async invite(actorUserId: string | null, b: { email: string; name: string; teams: string[] }) {
    const email = b.email.trim().toLowerCase();
    const teams = this.cleanTeams(b.teams);
    const existing = (await this.pool.query('SELECT id, password_hash FROM identity.staff_accounts WHERE email = $1', [email])).rows[0];
    if (existing) {
      if (existing.password_hash) throw new ConflictException('Já existe uma conta de equipa com este email');
      const token = await this.issueSetupToken(existing.id as string);
      return { accountId: existing.id as string, setupUrl: this.newLink(token), expiresInMinutes: SETUP_MINUTES };
    }
    const id = uuidv7();
    const userId = uuidv7();
    const tag = userId.slice(-8);
    const isAdmin = teams.includes('administracao');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // A identidade interna: nunca 'active' (não aparece na rede) e sem credenciais da rede (não entra nela).
      await client.query("INSERT INTO identity.users (id, email, username, display_name, status, is_admin) VALUES ($1, $2, $3, $4, 'staff', $5)", [userId, `staff-${tag}@staff.invalid`, `staff-${tag}`, b.name.trim(), isAdmin]);
      await client.query('INSERT INTO identity.staff_accounts (id, user_id, email, name) VALUES ($1, $2, $3, $4)', [id, userId, email, b.name.trim()]);
      await client.query('INSERT INTO identity.staff_members (user_id, teams, active, added_by) VALUES ($1, $2, true, $3)', [userId, teams.filter((t) => t !== 'administracao'), actorUserId ?? userId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    const token = await this.issueSetupToken(id);
    await this.audit(actorUserId ?? userId, 'staff.invite', `staff:${id}`, { email, teams });
    return { accountId: id, setupUrl: this.newLink(token), expiresInMinutes: SETUP_MINUTES };
  }

  private async validToken(token: string) {
    const r = (
      await this.pool.query(
        `SELECT t.token_hash, t.account_id, t.totp_pending, a.email, a.name
           FROM identity.staff_setup_tokens t JOIN identity.staff_accounts a ON a.id = t.account_id
          WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND a.active`,
        [sha(token)],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Esta ligação já não serve. Pede uma nova a quem gere a equipa.');
    return r as { token_hash: string; account_id: string; totp_pending: string | null; email: string; name: string };
  }

  /** Passo 1 da configuração: mostra o email e o segredo dos dois passos (para o QR). */
  async setupInfo(token: string) {
    const t = await this.validToken(token);
    let secret = t.totp_pending ? unseal(t.totp_pending, this.appSecret) : null;
    if (!secret) {
      secret = newSecret();
      await this.pool.query('UPDATE identity.staff_setup_tokens SET totp_pending = $2 WHERE token_hash = $1', [t.token_hash, seal(secret, this.appSecret)]);
    }
    return { email: t.email, name: t.name, secret, otpauth: otpauthUrl(secret, t.email) };
  }

  /** Passo 2: a senha nova e o código da app autenticadora (prova que os dois passos ficaram bem configurados). */
  async setupComplete(token: string, password: string, code: string) {
    const t = await this.validToken(token);
    if (password.length < 12) throw new BadRequestException('A senha tem de ter pelo menos 12 caracteres');
    if (!t.totp_pending) throw new BadRequestException('Abre primeiro a ligação para ver o QR dos dois passos');
    const secret = unseal(t.totp_pending, this.appSecret);
    if (!verifyTotp(secret, code)) throw new BadRequestException('Código dos dois passos errado. Tenta com o código atual da app.');
    const hash = await argon2.hash(password, ARGON_OPTS);
    const a = (
      await this.pool.query(
        `UPDATE identity.staff_accounts SET password_hash = $2, totp_secret = $3, totp_enabled = true, failed_logins = 0, locked_until = NULL, token_version = token_version + 1
          WHERE id = $1 RETURNING id, token_version, user_id`,
        [t.account_id, hash, seal(secret, this.appSecret)],
      )
    ).rows[0];
    await this.pool.query('UPDATE identity.staff_setup_tokens SET used_at = now() WHERE token_hash = $1', [t.token_hash]);
    await this.audit(a.user_id as string, 'staff.setup', `staff:${a.id as string}`);
    return { token: await this.sign(a), expiresInHours: SESSION_HOURS };
  }

  async login(email: string, password: string, code: string) {
    const a = (await this.pool.query('SELECT * FROM identity.staff_accounts WHERE email = $1', [email.trim().toLowerCase()])).rows[0];
    const bad = () => new UnauthorizedException('Email, senha ou código errados');
    if (!a || !a.active || !a.password_hash || !a.totp_enabled) {
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      throw bad();
    }
    if (a.locked_until && new Date(a.locked_until as string) > new Date()) throw new HttpException('Demasiadas tentativas. Tenta daqui a 15 minutos.', HttpStatus.TOO_MANY_REQUESTS);
    const okPass = await argon2.verify(a.password_hash as string, password).catch(() => false);
    const okCode = okPass && verifyTotp(unseal(a.totp_secret as string, this.appSecret), code);
    if (!okPass || !okCode) {
      const fails = (a.failed_logins as number) + 1;
      await this.pool.query('UPDATE identity.staff_accounts SET failed_logins = $2::int, locked_until = CASE WHEN $2::int >= $3::int THEN now() + ($4 || \' minutes\')::interval ELSE locked_until END WHERE id = $1', [a.id, fails, MAX_FAILS, String(LOCK_MINUTES)]);
      await this.audit(a.user_id as string, 'staff.login_failed', `staff:${a.id as string}`, { fails });
      throw bad();
    }
    await this.pool.query('UPDATE identity.staff_accounts SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [a.id]);
    await this.audit(a.user_id as string, 'staff.login', `staff:${a.id as string}`);
    return { token: await this.sign(a as { id: string; token_version: number }), expiresInHours: SESSION_HOURS };
  }

  /** Sair de todo o lado: as sessões desta conta deixam de valer. */
  async logoutEverywhere(accountId: string) {
    await this.pool.query('UPDATE identity.staff_accounts SET token_version = token_version + 1 WHERE id = $1', [accountId]);
  }

  async info(accountId: string) {
    const a = (await this.pool.query('SELECT email, name FROM identity.staff_accounts WHERE id = $1', [accountId])).rows[0];
    return { email: a?.email as string, name: a?.name as string };
  }

  // ───────── gestão da equipa (Administração) ─────────

  async list() {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.email, a.name, a.active, a.last_login_at, a.created_at, (a.password_hash IS NULL) AS pending, u.is_admin, coalesce(m.teams, '{}') AS teams
         FROM identity.staff_accounts a JOIN identity.users u ON u.id = a.user_id LEFT JOIN identity.staff_members m ON m.user_id = a.user_id
        ORDER BY u.is_admin DESC, a.created_at`,
    );
    return rows.map((r) => {
      const teams = new Set<string>(r.teams as string[]);
      if (r.is_admin) teams.add('administracao');
      return { id: r.id as string, email: r.email as string, name: r.name as string, active: r.active as boolean, pending: r.pending as boolean, teams: [...teams], lastLogin: (r.last_login_at as string | null) ?? null, createdAt: r.created_at as string };
    });
  }

  private async activeAdmins(excluding?: string) {
    return (await this.pool.query(`SELECT count(*)::int AS n FROM identity.staff_accounts a JOIN identity.users u ON u.id = a.user_id WHERE a.active AND u.is_admin AND ($1::uuid IS NULL OR a.id <> $1)`, [excluding ?? null])).rows[0].n as number;
  }

  private async account(id: string) {
    const a = (await this.pool.query('SELECT a.id, a.user_id, a.active, u.is_admin FROM identity.staff_accounts a JOIN identity.users u ON u.id = a.user_id WHERE a.id = $1', [id])).rows[0];
    if (!a) throw new NotFoundException('Conta de equipa não encontrada');
    return a as { id: string; user_id: string; active: boolean; is_admin: boolean };
  }

  async setTeams(actorUserId: string, id: string, teamsIn: string[], reason: string) {
    const teams = this.cleanTeams(teamsIn);
    const a = await this.account(id);
    const willAdmin = teams.includes('administracao');
    if (a.is_admin && !willAdmin && (await this.activeAdmins(id)) < 1) throw new ForbiddenException('Tem de ficar pelo menos uma pessoa na Administração');
    await this.pool.query(
      `INSERT INTO identity.staff_members (user_id, teams, active, added_by) VALUES ($1, $2, true, $3)
       ON CONFLICT (user_id) DO UPDATE SET teams = $2, active = true, updated_at = now()`,
      [a.user_id, teams.filter((t) => t !== 'administracao'), actorUserId],
    );
    await this.pool.query('UPDATE identity.users SET is_admin = $2 WHERE id = $1', [a.user_id, willAdmin]);
    await this.audit(actorUserId, 'staff.set_teams', `staff:${id}`, { teams, reason });
  }

  async setActive(actorUserId: string, id: string, active: boolean, reason: string) {
    const a = await this.account(id);
    if (!active && a.is_admin && (await this.activeAdmins(id)) < 1) throw new ForbiddenException('Tem de ficar pelo menos uma pessoa na Administração');
    await this.pool.query('UPDATE identity.staff_accounts SET active = $2, token_version = token_version + 1 WHERE id = $1', [id, active]);
    await this.audit(actorUserId, active ? 'staff.activate' : 'staff.deactivate', `staff:${id}`, { reason });
  }

  /** Repor o acesso (perdeu a senha ou o telemóvel): apaga a senha e os dois passos e gera uma ligação nova. */
  async resetAccess(actorUserId: string, id: string, reason: string) {
    await this.account(id);
    await this.pool.query('UPDATE identity.staff_accounts SET password_hash = NULL, totp_secret = NULL, totp_enabled = false, failed_logins = 0, locked_until = NULL, token_version = token_version + 1 WHERE id = $1', [id]);
    const token = await this.issueSetupToken(id);
    await this.audit(actorUserId, 'staff.reset_access', `staff:${id}`, { reason });
    return { setupUrl: this.newLink(token), expiresInMinutes: SETUP_MINUTES };
  }
}

import { BadRequestException, ConflictException, Inject, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { LoginInput, PublicUser, RegisterInput, usernameSchema, TERMS_VERSION } from '@txillapp/shared';
import { tierOf, type VerifiedTier } from '../common/badge';
import { describeDevice } from '../common/device';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { hashNet } from '../invites/rules';
import { SearchIndexer } from '../search/search-index';
import { PG_POOL } from '../db/db.module';
import { MailService } from '../mail/mail.service';
import { deleteAccountMail, loginLockedMail, newLoginMail, resetPasswordMail, sessionReuseMail, verifyEmailMail } from '../mail/templates';
import { isDisposableEmail } from '../security/disposable';
import { loginResults, registerResults } from '../security/metrics';
import { RiskService } from '../security/risk.service';
import { LOGIN } from '../security/rules';
import { ReqContext, SecurityService } from '../security/security.service';
import { AppleService } from './apple.service';
import { GoogleService } from './google.service';
import { isReservedUsername } from './reserved-usernames';

const ACCESS_TTL_S = 10 * 60;
// Sessão deslizante: cada renovação estende a validade. Só termina com logout (ou após 1 ano sem usar a app).
export const REFRESH_TTL_MS = 365 * 24 * 60 * 60 * 1000;
// Redes móveis instáveis: uma resposta perdida e repetida não deve ser tomada por roubo de token.
const REUSE_GRACE_MS = 120_000;
const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Quem tem a sessão, com o selo de verificado (e qual): a app grava-o na assinatura das fotos que a pessoa tira. */
export type SessionUser = Omit<PublicUser, 'verified' | 'verifiedTier'> & { verified: boolean; verifiedTier: VerifiedTier | null };
interface UserRow { id: string; username: string; display_name: string; verified?: boolean | null; verified_tier?: string | null }
const sessionUser = (r: UserRow): SessionUser => {
  const verified = r.verified === true;
  return { id: r.id, username: r.username, displayName: r.display_name, verified, verifiedTier: tierOf(verified, r.verified_tier) };
};


/** Um pedido sem contexto (scripts, chamadas internas): sem impressões nem prova de humano. */
const NO_CTX: ReqContext = { ip: null, net: null, device: null, deviceLabel: 'Aparelho desconhecido', client: 'other', humanRequired: false };

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly secret: Uint8Array;
  private readonly netSalt: string;
  // Hash falso para igualar o tempo de resposta quando o utilizador não existe.
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) config: AppConfig,
    private readonly google: GoogleService,
    private readonly apple: AppleService,
    private readonly indexer: SearchIndexer,
    private readonly mail: MailService,
    private readonly moduleRef: ModuleRef,
    private readonly security: SecurityService,
    private readonly risk: RiskService,
  ) {
    this.secret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
    this.netSalt = config.JWT_ACCESS_SECRET.slice(0, 16);
  }

  /** O hash falso fica pronto logo no arranque: o primeiro login de uma conta que não existe não demora o dobro. */
  onModuleInit() {
    void this.getDummyHash().catch(() => undefined);
  }

  /** Os hashes de senha passam todos pelo semáforo (ver security/hash-gate.ts). */
  private hashPassword(p: string) {
    return this.security.hashGate.run(() => argon2.hash(p, ARGON_OPTS));
  }
  private verifyPassword(hash: string, p: string) {
    return this.security.hashGate.run(() => argon2.verify(hash, p));
  }

  /** Disponibilidade de um @ (insensível a maiúsculas), incluindo nomes reservados. */
  async usernameAvailable(
    raw: string,
  ): Promise<{ available: boolean; reason?: 'invalid' | 'reserved' | 'taken'; suggestions?: string[] }> {
    const u = raw.trim().replace(/^@/, '');
    if (!usernameSchema.safeParse(u).success) return { available: false, reason: 'invalid' };
    if (isReservedUsername(u)) return { available: false, reason: 'reserved' };
    const r = await this.pool.query('SELECT 1 FROM identity.users WHERE username = $1', [u]);
    if (!r.rowCount) return { available: true };
    return { available: false, reason: 'taken', suggestions: await this.alternatives(u) };
  }

  /** Alternativas livres para um @ que já tem dono. */
  private async alternatives(base: string): Promise<string[]> {
    const stem = base.slice(0, 24);
    const n = () => Math.floor(10 + Math.random() * 90);
    const candidates = [...new Set([`${stem}_${n()}`, `${stem}.mz`, `${stem}${new Date().getFullYear() % 100}`, `${stem}${n()}`, `o.${stem}`, `${stem}_oficial`])]
      .filter((c) => c.length <= 30 && usernameSchema.safeParse(c).success && !isReservedUsername(c));
    const taken = await this.pool.query('SELECT username FROM identity.users WHERE username = ANY($1)', [candidates]);
    const used = new Set(taken.rows.map((r) => String(r.username).toLowerCase()));
    return candidates.filter((c) => !used.has(c.toLowerCase())).slice(0, 3);
  }

  async emailAvailable(raw: string): Promise<{ available: boolean; reason?: 'invalid' | 'taken' }> {
    const email = raw.trim().toLowerCase();
    if (!z.string().email().max(254).safeParse(email).success) return { available: false, reason: 'invalid' };
    const r = await this.pool.query('SELECT 1 FROM identity.users WHERE email = $1', [email]);
    return r.rowCount ? { available: false, reason: 'taken' } : { available: true };
  }

  async register(input: RegisterInput, userAgent?: string, ip?: string, ctx: ReqContext = NO_CTX) {
    if (isReservedUsername(input.username)) throw new ConflictException('Esse nome está reservado');
    // Antes de gastar CPU com o hash: limites de contas novas por rede, email temporário e prova de humano.
    await this.security.registerGate(ctx).catch((e) => {
      registerResults.inc({ result: 'limited' });
      throw e;
    });
    if (isDisposableEmail(input.email)) {
      registerResults.inc({ result: 'disposable' });
      void this.security.event('register_disposable', ctx, null, { domain: input.email.split('@')[1]?.toLowerCase() });
      throw new BadRequestException({ code: 'disposable_email', message: 'Usa um e-mail a sério (os temporários não dão).' });
    }
    const human = await this.security.requireHuman(ctx, 'register').catch((e) => {
      registerResults.inc({ result: 'human_check' });
      throw e;
    });
    const id = uuidv7();
    const hash = await this.hashPassword(input.password);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO identity.users (id, email, username, display_name, gender, birth_date, terms_accepted_at, terms_version)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7)`,
        [id, input.email, input.username, input.displayName, input.gender ?? null, input.birthDate, TERMS_VERSION],
      );
      await client.query('INSERT INTO identity.credentials (user_id, password_hash) VALUES ($1, $2)', [id, hash]);
      await this.audit(client, id, 'auth.register');
      await this.risk.seed(client, id);
      const tokens = await this.issueSession(client, id, uuidv7(), userAgent);
      await client.query('COMMIT');
      registerResults.inc({ result: 'ok' });
      this.indexer.userChanged(id);
      void this.sendVerification(id).catch(() => undefined);
      // A pontuação de risco primeiro: os convites usam-na (mesmo aparelho, mesmo email, conta suspeita).
      await this.risk.onRegister(id, ctx, { username: input.username, displayName: input.displayName, email: input.email, human: human === 'passed' });
      void this.attachReferral(id, input.inviteCode, input.email, ip);
      return { tokens, user: { id, username: input.username, displayName: input.displayName } };
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23505') {
        // Corrida rara (a verificação em tempo real já avisou antes): diz exactamente qual dos dois.
        const which = String((e as { constraint?: string }).constraint ?? '');
        throw new ConflictException(which.includes('email') ? 'Esse email já tem conta' : 'Esse nome de utilizador já tem dono');
      }
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Regista que esta pessoa entrou com o convite de alguém (nunca falha o registo). A rede é guardada só como impressão.
   * As regras (antifraude, aviso a quem convidou, Txills de boas-vindas do convite) vivem no serviço dos convites, que
   * depende deste módulo: vai-se buscá-lo só aqui, sem criar um ciclo.
   */
  private async attachReferral(inviteeId: string, rawCode: string | undefined, email: string, ip: string | undefined) {
    if (!rawCode) return;
    try {
      const { InvitesService } = await import('../invites/invites.service');
      const net = ip ? hashNet(ip, this.netSalt) : null;
      await this.moduleRef.get(InvitesService, { strict: false }).attach(inviteeId, rawCode, email, net);
    } catch {
      /* o convite não pode estragar o registo */
    }
  }

  /**
   * Login com senha. A mesma resposta e o mesmo trabalho para uma conta que não existe e para uma senha errada (o hash
   * corre sempre, com um hash falso quando a conta não existe). Antes do hash: o IP ou a conta estão bloqueados? (429, sem
   * gastar CPU) e, depois de algumas falhas, a prova de humano. Depois de N falhas a conta fica bloqueada um bocado, com
   * espera progressiva, e o dono recebe um email.
   */
  async login(input: LoginInput, userAgent?: string, ctx: ReqContext = NO_CTX) {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.username, u.display_name, u.verified, u.verified_tier, u.status, c.password_hash
         FROM identity.users u JOIN identity.credentials c ON c.user_id = u.id
        WHERE u.email = $1 OR u.username = $1`,
      [input.identifier],
    );
    const row = rows[0];
    try {
      await this.security.beforeLogin(ctx, input.identifier, row?.id ?? null);
    } catch (e) {
      loginResults.inc({ result: (e as { getStatus?: () => number }).getStatus?.() === 429 ? 'locked' : 'human_check' });
      throw e;
    }
    const ok = await this.verifyPassword(row?.password_hash ?? (await this.getDummyHash()), input.password).catch((e) => {
      loginResults.inc({ result: 'busy' });
      void this.security.event('hash_busy', ctx, null);
      throw e;
    });
    if (!row || !ok || row.status !== 'active') {
      loginResults.inc({ result: 'bad_credentials' });
      // Só conta como falha da conta quando ela existe e a senha está errada (a conta suspensa com a senha certa não).
      const userId = row && !ok ? (row.id as string) : null;
      const { locked } = await this.security.loginFailed(ctx, input.identifier, userId);
      if (locked && userId) void this.warnLocked(userId, locked, ctx);
      throw new UnauthorizedException('Credenciais inválidas');
    }
    loginResults.inc({ result: 'ok' });
    await this.security.loginSucceeded(input.identifier, row.id);
    const known = await this.knownDevice(row.id, userAgent);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tokens = await this.issueSession(client, row.id, uuidv7(), userAgent);
      await this.audit(client, row.id, 'auth.login');
      await client.query('COMMIT');
      if (!known) void this.noticeNewLogin(row.id, userAgent, 'com a senha', ctx);
      return { tokens, user: sessionUser(row) };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /** Rotação: cada refresh token só é usado uma vez; reutilização revoga toda a família. */
  async refresh(refreshToken: string, userAgent?: string, ctx: ReqContext = NO_CTX) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT s.id, s.user_id, s.family_id, s.expires_at, s.used_at, s.revoked_at,
                u.username, u.display_name, u.verified, u.verified_tier, u.status
           FROM identity.sessions s JOIN identity.users u ON u.id = s.user_id
          WHERE s.token_hash = $1 FOR UPDATE OF s`,
        [sha256(refreshToken)],
      );
      const s = rows[0];
      if (!s) throw new UnauthorizedException();
      // Tolerância curta: vários separadores/pedidos simultâneos com o mesmo cookie não são roubo.
      const recentlyUsed = s.used_at && !s.revoked_at && Date.now() - new Date(s.used_at).getTime() < REUSE_GRACE_MS;
      if ((s.used_at && !recentlyUsed) || s.revoked_at) {
        await client.query('UPDATE identity.sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [s.family_id]);
        await this.audit(client, s.user_id, 'auth.refresh_reuse_detected', s.family_id);
        await client.query('COMMIT');
        // Só na primeira vez (a família ainda não estava terminada): o resto são repetições do mesmo aparelho.
        if (!s.revoked_at) void this.warnReuse(s.user_id as string, s.family_id as string, userAgent, ctx);
        throw new UnauthorizedException();
      }
      if (new Date(s.expires_at) < new Date() || s.status !== 'active') throw new UnauthorizedException();
      await client.query('UPDATE identity.sessions SET used_at = COALESCE(used_at, now()) WHERE id = $1', [s.id]);
      const tokens = await this.issueSession(client, s.user_id, s.family_id, userAgent);
      await client.query('COMMIT');
      return { tokens, user: sessionUser({ ...s, id: s.user_id }) };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async logout(refreshToken: string) {
    await this.pool.query(
      `UPDATE identity.sessions SET revoked_at = now()
        WHERE revoked_at IS NULL AND family_id =
          (SELECT family_id FROM identity.sessions WHERE token_hash = $1)`,
      [sha256(refreshToken)],
    );
  }

  /** Login com Google: sessão directa se a conta já existe; caso contrário pede o @ (registo em 2 passos). */
  async googleLogin(idToken: string, userAgent?: string, ctx: ReqContext = NO_CTX) {
    const p = await this.google.verify(idToken);
    const found = await this.pool.query(
      `SELECT id, username, display_name, verified, verified_tier, status FROM identity.users WHERE google_sub = $1`,
      [p.sub],
    );
    const u = found.rows[0];
    if (u) {
      if (u.status !== 'active') throw new UnauthorizedException('Conta indisponível');
      const known = await this.knownDevice(u.id, userAgent);
      const tokens = await this.sessionFor(u.id, 'auth.google_login', userAgent);
      if (!known) void this.noticeNewLogin(u.id, userAgent, 'com a Google', ctx);
      return { kind: 'session' as const, tokens, user: sessionUser(u) };
    }
    // Não se liga automaticamente a uma conta existente com o mesmo email (evita tomadas de conta por email não verificado).
    if ((await this.pool.query('SELECT 1 FROM identity.users WHERE email = $1', [p.email])).rowCount) {
      throw new ConflictException('Já existe uma conta com este email. Entra com a tua senha.');
    }
    const signupToken = await new SignJWT({ email: p.email, name: p.name })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(p.sub)
      .setIssuer('txillapp')
      .setAudience('google-signup')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(this.secret);
    return { kind: 'signup' as const, signupToken, displayName: p.name.slice(0, 60), suggestedUsername: await this.suggestUsername(p.email) };
  }

  async googleComplete(signupToken: string, rawUsername: string, userAgent?: string, gender?: string, birthDate?: string, ctx: ReqContext = NO_CTX) {
    await this.security.registerGate(ctx);
    let claims;
    try {
      claims = (await jwtVerify(signupToken, this.secret, { algorithms: ['HS256'], issuer: 'txillapp', audience: 'google-signup' })).payload;
    } catch {
      throw new UnauthorizedException('O pedido expirou. Entra com a Google outra vez.');
    }
    const username = rawUsername.trim().replace(/^@/, '');
    const a = await this.usernameAvailable(username);
    if (!a.available) {
      throw new ConflictException(a.reason === 'invalid' ? 'Nome de utilizador inválido' : a.reason === 'reserved' ? 'Esse nome está reservado' : 'Esse já tem dono');
    }
    const id = uuidv7();
    const displayName = String(claims.name ?? username).slice(0, 60);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO identity.users (id, email, username, display_name, google_sub, gender, birth_date, terms_accepted_at, terms_version, email_verified_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, now())`,
        [id, claims.email, username, displayName, claims.sub, gender ?? null, birthDate ?? null, TERMS_VERSION],
      );
      await this.audit(client, id, 'auth.google_register');
      await this.risk.seed(client, id);
      const tokens = await this.issueSession(client, id, uuidv7(), userAgent);
      await client.query('COMMIT');
      registerResults.inc({ result: 'ok' });
      this.indexer.userChanged(id);
      // A Google já fez as contas dela à prova de humano.
      await this.risk.onRegister(id, ctx, { username, displayName, email: String(claims.email ?? ''), human: true });
      return { tokens, user: { id, username, displayName } };
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Esse já tem dono, ou esta conta Google já está registada');
      throw e;
    } finally {
      client.release();
    }
  }

  get googleClientId() {
    return this.google.clientIdPublic;
  }

  /**
   * Iniciar sessão com a Apple. `fullName` só vem da app na primeira vez (a Apple não o repete).
   * Conta já ligada: entra. Conta nova: devolve um pedido para escolher o @ (como na Google). Nunca se liga sozinha a uma conta
   * existente só por ter o mesmo email.
   */
  async appleLogin(identityToken: string, nonce: string | undefined, fullName: string | undefined, userAgent?: string, ctx: ReqContext = NO_CTX) {
    const p = await this.apple.verify(identityToken, nonce);
    const found = await this.pool.query(`SELECT id, username, display_name, verified, verified_tier, status FROM identity.users WHERE apple_sub = $1`, [p.sub]);
    const u = found.rows[0];
    if (u) {
      if (u.status !== 'active') throw new UnauthorizedException('Conta indisponível');
      const known = await this.knownDevice(u.id, userAgent);
      const tokens = await this.sessionFor(u.id, 'auth.apple_login', userAgent);
      if (!known) void this.noticeNewLogin(u.id, userAgent, 'com a Apple', ctx);
      return { kind: 'session' as const, tokens, user: sessionUser(u) };
    }
    // Sem email (a pessoa escondeu-o e a Apple não o confirmou) a conta fica sem email até ele ser confirmado mais tarde.
    const email = p.email ?? `${p.sub.replace(/[^a-z0-9]/gi, '').toLowerCase()}@appleid.invalid`;
    if (p.email && (await this.pool.query('SELECT 1 FROM identity.users WHERE email = $1', [p.email])).rowCount) {
      throw new ConflictException('Já existe uma conta com este email. Entra com a tua senha.');
    }
    const name = (fullName ?? '').trim().slice(0, 60) || (p.email ? p.email.split('@')[0] : 'Malta');
    const signupToken = await new SignJWT({ email, name, privateEmail: !p.email || p.isPrivateEmail })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(p.sub)
      .setIssuer('txillapp')
      .setAudience('apple-signup')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(this.secret);
    return { kind: 'signup' as const, signupToken, displayName: name, suggestedUsername: await this.suggestUsername(p.email ?? name) };
  }

  async appleComplete(signupToken: string, rawUsername: string, userAgent?: string, gender?: string, birthDate?: string, ctx: ReqContext = NO_CTX) {
    await this.security.registerGate(ctx);
    let claims;
    try {
      claims = (await jwtVerify(signupToken, this.secret, { algorithms: ['HS256'], issuer: 'txillapp', audience: 'apple-signup' })).payload;
    } catch {
      throw new UnauthorizedException('O pedido expirou. Entra com a Apple outra vez.');
    }
    const username = rawUsername.trim().replace(/^@/, '');
    const a = await this.usernameAvailable(username);
    if (!a.available) {
      throw new ConflictException(a.reason === 'invalid' ? 'Nome de utilizador inválido' : a.reason === 'reserved' ? 'Esse nome está reservado' : 'Esse já tem dono');
    }
    const id = uuidv7();
    const displayName = String(claims.name ?? username).slice(0, 60);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Email de reencaminhamento ou desconhecido: a conta fica por confirmar (email_verified_at nulo) até a pessoa pôr um email.
      const verified = !claims.privateEmail;
      await client.query(
        `INSERT INTO identity.users (id, email, username, display_name, apple_sub, gender, birth_date, terms_accepted_at, terms_version, email_verified_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, ${verified ? 'now()' : 'NULL'})`,
        [id, claims.email, username, displayName, claims.sub, gender ?? null, birthDate ?? null, TERMS_VERSION],
      );
      await this.audit(client, id, 'auth.apple_register');
      await this.risk.seed(client, id);
      const tokens = await this.issueSession(client, id, uuidv7(), userAgent);
      await client.query('COMMIT');
      registerResults.inc({ result: 'ok' });
      this.indexer.userChanged(id);
      await this.risk.onRegister(id, ctx, { username, displayName, email: String(claims.email ?? ''), human: true });
      return { tokens, user: { id, username, displayName } };
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Esse já tem dono, ou esta conta Apple já está registada');
      throw e;
    } finally {
      client.release();
    }
  }

  get appleClientId() {
    return this.apple.enabled ? 'enabled' : null;
  }

  private async sessionFor(userId: string, action: string, userAgent?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tokens = await this.issueSession(client, userId, uuidv7(), userAgent);
      await this.audit(client, userId, action);
      await client.query('COMMIT');
      return tokens;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  private async suggestUsername(email: string) {
    let base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 20);
    if (base.length < 3) base = 'user' + base;
    for (let i = 0; i < 6; i++) {
      const candidate = i === 0 ? base : `${base.slice(0, 24)}${Math.floor(100 + Math.random() * 900)}`;
      if ((await this.usernameAvailable(candidate)).available) return candidate;
    }
    return '';
  }

  /** Altera a senha, termina todas as sessões e devolve uma sessão nova para o dispositivo actual. */
  async changePassword(userId: string, current: string, next: string, userAgent?: string) {
    const { rows } = await this.pool.query('SELECT password_hash FROM identity.credentials WHERE user_id = $1', [userId]);
    if (!rows[0]) throw new BadRequestException('Esta conta entra com a Google e não tem senha');
    if (!(await this.verifyPassword(rows[0].password_hash, current))) throw new UnauthorizedException('A senha atual não está certa');
    if (current === next) throw new BadRequestException('A nova senha tem de ser diferente da atual');
    const hash = await this.hashPassword(next);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE identity.credentials SET password_hash = $2, updated_at = now() WHERE user_id = $1', [userId, hash]);
      await client.query('UPDATE identity.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      const tokens = await this.issueSession(client, userId, uuidv7(), userAgent);
      await this.audit(client, userId, 'auth.password_changed');
      await client.query('COMMIT');
      return { tokens, user: await this.getUser(userId) };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Dispositivos com sessão iniciada (um por "família" de refresh tokens): o aparelho, quando entrou e a última atividade. */
  async sessions(userId: string, currentRefreshToken?: string) {
    const current = currentRefreshToken
      ? (await this.pool.query('SELECT family_id FROM identity.sessions WHERE token_hash = $1 AND user_id = $2', [sha256(currentRefreshToken), userId])).rows[0]?.family_id
      : undefined;
    const { rows } = await this.pool.query(
      `SELECT family_id, min(created_at) AS first_seen, max(greatest(created_at, used_at)) AS last_used,
              (array_agg(user_agent ORDER BY created_at DESC))[1] AS ua
         FROM identity.sessions WHERE user_id = $1
        GROUP BY family_id
       HAVING bool_or(revoked_at IS NULL AND expires_at > now())
        ORDER BY max(greatest(created_at, used_at)) DESC LIMIT 30`,
      [userId],
    );
    return rows.map((r) => {
      const d = describeDevice(r.ua);
      return {
        id: r.family_id as string,
        device: d.label,
        kind: d.kind,
        mobile: d.mobile,
        firstSeen: r.first_seen,
        lastUsed: r.last_used,
        current: r.family_id === current,
      };
    });
  }

  async revokeSession(userId: string, familyId: string) {
    await this.pool.query('UPDATE identity.sessions SET revoked_at = now() WHERE user_id = $1 AND family_id = $2 AND revoked_at IS NULL', [userId, familyId]);
  }

  /** "Terminar sessão em todos os outros dispositivos": mantém só o actual. */
  async revokeOtherSessions(userId: string, currentRefreshToken?: string) {
    const current = currentRefreshToken
      ? (await this.pool.query('SELECT family_id FROM identity.sessions WHERE token_hash = $1 AND user_id = $2', [sha256(currentRefreshToken), userId])).rows[0]?.family_id
      : null;
    await this.pool.query(
      'UPDATE identity.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR family_id <> $2)',
      [userId, current],
    );
  }

  /**
   * Eliminar a conta: anonimiza os dados pessoais, termina as sessões e remove ligações e stories.
   * As publicações deixam de ser visíveis; os registos financeiros mantêm-se (auditoria), sem dados pessoais.
   */
  async deleteAccount(userId: string, confirmUsername: string, password?: string) {
    const { rows } = await this.pool.query(
      'SELECT u.username, c.password_hash FROM identity.users u LEFT JOIN identity.credentials c ON c.user_id = u.id WHERE u.id = $1 AND u.status = \'active\'',
      [userId],
    );
    const u = rows[0];
    if (!u) throw new UnauthorizedException();
    if (confirmUsername.trim().replace(/^@/, '').toLowerCase() !== String(u.username).toLowerCase()) {
      throw new BadRequestException('Escreve o teu @ exactamente para confirmar');
    }
    if (u.password_hash && !(password && (await this.verifyPassword(u.password_hash, password)))) {
      throw new UnauthorizedException('A senha não está certa');
    }
    await this.eraseAccount(userId, String(u.username), 'account.deleted');
  }

  /* ───── eliminar a conta sem sessão (página pública txillapp.com/apagar-conta) ───── */

  /** Um resumo do email na ligação: se o email da conta mudar, a ligação deixa de valer. */
  private deletionMark(email: string) {
    return sha256(`apagar|${String(email).toLowerCase()}`).slice(0, 16);
  }

  /**
   * "Quero apagar a minha conta" sem sessão: manda para o email da conta uma ligação que vale 1 hora. Nunca apaga nada aqui
   * (escrever um email não chega) e responde sempre igual, exista ou não a conta, para não revelar quem está registado.
   */
  async requestAccountDeletion(rawEmail: string, ctx: ReqContext = NO_CTX) {
    const email = rawEmail.trim().toLowerCase();
    // No máximo 3 emails por hora para o mesmo endereço (a resposta é igual: não diz se travou).
    if (this.mail.enabled && z.string().email().max(254).safeParse(email).success && (await this.security.mailAllowed('delete', email, ctx))) {
      const { rows } = await this.pool.query("SELECT id, email, display_name FROM identity.users WHERE lower(email) = $1 AND status = 'active'", [email]);
      const u = rows[0];
      if (u) {
        const token = await new SignJWT({ m: this.deletionMark(u.email) })
          .setProtectedHeader({ alg: 'HS256' })
          .setSubject(u.id)
          .setIssuer('txillapp')
          .setAudience('account-delete')
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(this.secret);
        await this.mail.send({ to: u.email, ...deleteAccountMail(this.mail.publicUrl, String(u.display_name).split(' ')[0], token) });
      }
    }
    // `mail: false` é igual para toda a gente (o servidor não envia emails): a página manda apagar na app em vez de esperar.
    return { ok: true, mail: this.mail.enabled };
  }

  /** A conta a que a ligação do email se refere (ainda ativa e com o mesmo email), ou erro. */
  private async deletionTarget(token: string) {
    const bad = () => new BadRequestException('Esta ligação já não vale. Pede outra em txillapp.com/apagar-conta.');
    let claims;
    try {
      claims = (await jwtVerify(token, this.secret, { algorithms: ['HS256'], issuer: 'txillapp', audience: 'account-delete' })).payload;
    } catch {
      throw bad();
    }
    const { rows } = await this.pool.query("SELECT id, username, display_name, email FROM identity.users WHERE id = $1 AND status = 'active'", [claims.sub]);
    const u = rows[0];
    if (!u || claims.m !== this.deletionMark(u.email)) throw bad();
    return u as { id: string; username: string; display_name: string };
  }

  /** O que a página mostra antes de confirmar: de que conta se trata. */
  async deletionPreview(token: string) {
    const u = await this.deletionTarget(token);
    return { username: u.username, displayName: u.display_name };
  }

  /** Confirmado na página aberta pela ligação do email: apaga a conta, como em Definições → Conta → Eliminar conta. */
  async confirmAccountDeletion(token: string) {
    const u = await this.deletionTarget(token);
    await this.eraseAccount(u.id, u.username, 'account.deleted_by_email_link');
  }

  /**
   * Apaga a conta (já confirmada por quem pediu): usado pela app (com o @ e a senha) e pela ligação do email.
   * A linha da conta fica, anonimizada, porque os movimentos de Txills e os registos de convites apontam para ela.
   */
  private async eraseAccount(userId: string, username: string, auditAction: string) {
    // Sai dos TxillGroups como quem sai pelo próprio pé: passa a administração, e um grupo que fica vazio devolve o cofre e fecha.
    // (O serviço dos grupos vive no módulo do chat, que já depende deste; vai-se buscá-lo só aqui, sem criar um ciclo.)
    const groups = (await this.pool.query('SELECT group_id FROM social.group_members WHERE user_id = $1', [userId])).rows;
    if (groups.length) {
      const { GroupsService } = await import('../chat/groups.service');
      const svc = this.moduleRef.get(GroupsService, { strict: false });
      for (const g of groups) await svc.removeMember(userId, g.group_id as string, username).catch(() => undefined);
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE identity.users SET status = 'deleted', username = 'eliminado_' || substr(replace(id::text, '-', ''), 1, 12),
                display_name = 'Conta eliminada', email = 'deleted+' || id::text || '@invalid.local',
                bio = NULL, google_sub = NULL, apple_sub = NULL, avatar_media_id = NULL, is_private = true, gender = NULL, birth_date = NULL,
                city = NULL, website = NULL, country = NULL, last_seen_at = NULL
          WHERE id = $1`,
        [userId],
      );
      await client.query('DELETE FROM identity.credentials WHERE user_id = $1', [userId]);
      // As sessões saem de vez (com o tipo de aparelho e de browser), não ficam só terminadas.
      await client.query('DELETE FROM identity.sessions WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM social.follows WHERE follower_id = $1 OR followee_id = $1', [userId]);
      await client.query('DELETE FROM social.follow_requests WHERE requester_id = $1 OR target_id = $1', [userId]);
      await client.query('DELETE FROM social.suggestion_dismissals WHERE user_id = $1 OR dismissed_id = $1', [userId]);
      await client.query('DELETE FROM social.story_hidden WHERE owner_id = $1 OR hidden_id = $1', [userId]);
      await client.query('DELETE FROM taste.user_items WHERE user_id = $1', [userId]);
      // Brindes à geleira, dados e recebidos (a conta só fica anonimizada, por isso o CASCADE não chega).
      await client.query('DELETE FROM taste.geleira_cheers WHERE owner_id = $1 OR user_id = $1', [userId]);
      await client.query('DELETE FROM taste.geleira_cheer_notices WHERE owner_id = $1 OR user_id = $1', [userId]);
      // Brindes aos itens da geleira (no perfil ou nos posts da geleira, 0143), dados e recebidos.
      await client.query('DELETE FROM taste.geleira_item_cheers WHERE owner_id = $1 OR user_id = $1', [userId]);
      // O nível da geleira guardado (0146), com o detalhe dos pontos.
      await client.query('DELETE FROM taste.geleira_levels WHERE user_id = $1', [userId]);
      // «Paga-me uma» (0145): os pedidos (feitos e recebidos), as dívidas (dos dois lados), as rodadas que abriu, as entradas nas
      // rodadas dos outros e o registo dos avisos de sexta. As rodadas que pagou ficam no histórico do grupo, sem quem pagou.
      // Os cartões do chat do outro lado ficam «Conta eliminada» (o pedido já não existe).
      await client.query('DELETE FROM taste.gelada_debts WHERE debtor_id = $1 OR creditor_id = $1', [userId]);
      await client.query('DELETE FROM taste.gelada_requests WHERE requester_id = $1 OR recipient_id = $1', [userId]);
      await client.query('DELETE FROM taste.gelada_round_entries WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM taste.gelada_rounds WHERE opened_by = $1', [userId]);
      await client.query('UPDATE taste.gelada_rounds SET payer_id = NULL WHERE payer_id = $1', [userId]);
      await client.query('DELETE FROM taste.gelada_fridays WHERE user_id = $1', [userId]);
      await client.query(`UPDATE taste.items SET created_by = NULL WHERE created_by = $1 AND status = 'pending'`, [userId]);
      await client.query('DELETE FROM social.blocks WHERE blocker_id = $1 OR blocked_id = $1', [userId]);
      await client.query('DELETE FROM social.notifications WHERE user_id = $1 OR actor_id = $1', [userId]);
      await client.query('DELETE FROM content.stories WHERE author_id = $1', [userId]);
      // Conversas (e as mensagens nelas), listas, subscrições de notificações e denúncias feitas por esta conta.
      await client.query('DELETE FROM social.conversations WHERE user_a = $1 OR user_b = $1', [userId]);
      await client.query('DELETE FROM social.close_friends WHERE owner_id = $1 OR friend_id = $1', [userId]);
      await client.query('DELETE FROM social.push_subscriptions WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM analytics.events WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM content.story_comments WHERE author_id = $1', [userId]);
      // Tudo o resto que é da pessoa: chamadas, músicas favoritas, aparelhos, check-ins, locais que seguia e páginas que geria.
      await client.query('DELETE FROM social.calls WHERE caller_id = $1 OR callee_id = $1', [userId]);
      await client.query('DELETE FROM content.music_favorites WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM content.compose_jobs WHERE owner_id = $1', [userId]); // os pedidos de montagem guardam os textos do projeto
      // «Não gosto desta» (0128): as marcas são da pessoa (as contagens para o limiar descem com elas).
      await client.query('DELETE FROM content.music_dislikes WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM social.push_devices WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM content.checkins WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM content.venue_follows WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM content.venue_managers WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM social.group_rsvps WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM social.group_poll_votes WHERE user_id = $1', [userId]);
      // A conta fica anonimizada (a linha não se apaga), por isso o CASCADE não chega: os pedidos para entrar em grupos vão-se aqui.
      await client.query('DELETE FROM social.group_join_requests WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM nearby.presence WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM nearby.settings WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM content.venue_event_interest WHERE user_id = $1', [userId]);
      // O resto do rasto: comentários (e as respostas a eles), brindes e reações, mensagens em TxillGroups, notas, Zás,
      // conversas com o SuperTxill, guardados, vistas, preferências, identificações em fotos, pedidos e denúncias feitas.
      // Ficam só os movimentos de Txills (ledger e presentes), sem dados pessoais, porque a contabilidade tem de bater certo.
      for (const sql of [
        'DELETE FROM content.comments WHERE author_id = $1',
        // O que a moderação removeu (com a cópia dos comentários removidos, guardada para os poder repor) sai também (0121).
        'DELETE FROM content.moderation_removals WHERE author_id = $1',
        'DELETE FROM content.cheers WHERE user_id = $1',
        'DELETE FROM content.comment_cheers WHERE user_id = $1',
        // Quem já foi contado nos avisos de brindes (dados e recebidos) e o travão desses avisos no telemóvel.
        'DELETE FROM social.cheer_notices WHERE user_id = $1 OR owner_id = $1',
        'DELETE FROM social.cheer_pushes WHERE user_id = $1',
        'DELETE FROM content.story_views WHERE viewer_id = $1',
        'DELETE FROM content.story_own_seen WHERE user_id = $1',
        'DELETE FROM content.story_replies WHERE author_id = $1',
        'DELETE FROM content.story_cheers WHERE user_id = $1',
        'DELETE FROM content.photo_tags WHERE tagged_id = $1',
        'DELETE FROM content.saved_posts WHERE user_id = $1',
        'DELETE FROM content.post_feedback WHERE user_id = $1',
        'DELETE FROM content.feed_impressions WHERE user_id = $1',
        'DELETE FROM social.messages WHERE sender_id = $1',
        'DELETE FROM social.message_reactions WHERE user_id = $1',
        'DELETE FROM social.message_views WHERE user_id = $1',
        // "Apagar para mim" das mensagens dos outros (as minhas já saíram em cima, e com elas o que os outros esconderam).
        // As edições, os sítios e as partilhas em direto (também as que estavam a decorrer) vivem na linha da mensagem: saem com ela.
        'DELETE FROM social.message_hidden WHERE user_id = $1',
        'DELETE FROM social.notes WHERE user_id = $1',
        'DELETE FROM social.note_cheers WHERE user_id = $1',
        'DELETE FROM social.instants WHERE author_id = $1',
        'DELETE FROM social.instant_views WHERE viewer_id = $1',
        'DELETE FROM social.instant_reactions WHERE user_id = $1',
        'DELETE FROM social.ai_messages WHERE user_id = $1',
        'DELETE FROM social.bot_usage WHERE user_id = $1',
        'DELETE FROM social.notification_prefs WHERE user_id = $1',
        // Lembretes de regresso: o registo de quando e por onde foram (0129).
        'DELETE FROM social.comeback_reminders WHERE user_id = $1',
        'DELETE FROM social.profile_views WHERE profile_id = $1 OR viewer_id = $1',
        'DELETE FROM social.explore_prefs WHERE user_id = $1',
        'DELETE FROM social.explore_people WHERE user_id = $1 OR person_id = $1',
        'DELETE FROM social.feed_settings WHERE user_id = $1',
        'DELETE FROM social.reports WHERE reporter_id = $1',
        'DELETE FROM identity.verification_requests WHERE user_id = $1',
        'DELETE FROM identity.email_tokens WHERE user_id = $1',
        'DELETE FROM social.group_expense_shares WHERE user_id = $1',
        'DELETE FROM social.group_expenses WHERE paid_by = $1',
        'UPDATE social.group_expenses SET created_by = NULL WHERE created_by = $1',
        'UPDATE social.group_checklist SET assignee_id = NULL WHERE assignee_id = $1',
        'UPDATE social.group_checklist SET created_by = NULL WHERE created_by = $1',
        'UPDATE social.group_polls SET created_by = NULL WHERE created_by = $1',
        'UPDATE social.groups SET created_by = NULL WHERE created_by = $1',
        'UPDATE content.venue_events SET created_by = NULL WHERE created_by = $1',
        // Bombar: os destaques que escondeu saem; as vezes que viu ou tocou ficam só nos totais, sem pessoa;
        // as campanhas são do local, por isso só se tira quem as criou ou parou.
        'DELETE FROM content.boost_hidden WHERE user_id = $1',
        'UPDATE content.boost_impressions SET user_id = NULL WHERE user_id = $1',
        'UPDATE content.boost_campaigns SET created_by = NULL WHERE created_by = $1',
        'UPDATE content.boost_campaigns SET stopped_by = NULL WHERE stopped_by = $1',
        // Pedidos de recarga: ficam para a contabilidade, mas sem os últimos dígitos do telemóvel.
        "UPDATE payments.orders SET phone_tail = NULL WHERE user_id = $1",
        // Compras pela loja: ficam para a contabilidade e para os reembolsos que a loja ainda mande, mas sem o que a loja
        // disse da transação; a verificação paga (elegibilidade e o selo anterior) sai. A subscrição cancela-se na loja.
        "UPDATE payments.iap_purchases SET raw = '{}' WHERE user_id = $1",
        "DELETE FROM payments.paid_verification WHERE user_id = $1",
        // Programa de artistas (0131): as faixas do artista deixam de estar disponíveis (e de tocar, também nos usos antigos);
        // o pedido de artista (nome artístico, ligações, declaração) sai; os usos que fiz de faixas de outros saem dos totais;
        // as denúncias de direitos que fiz saem (e a faixa volta a aparecer se não houver outra aberta). Fica só o registo de
        // quem aceitou a licença e quando (prova da autorização), ligado à conta anonimizada.
        "UPDATE content.artist_tracks SET status = 'removed', removed_at = coalesce(removed_at, now()), review_reason = coalesce(review_reason, 'Conta eliminada') WHERE artist_id = $1 AND status <> 'removed'",
        'DELETE FROM content.artist_profiles WHERE user_id = $1',
        'DELETE FROM content.artist_track_uses WHERE user_id = $1',
        'DELETE FROM content.artist_track_claims WHERE reporter_id = $1',
        `UPDATE content.artist_tracks t SET hold_at = NULL WHERE $1::uuid IS NOT NULL AND t.hold_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM content.artist_track_claims c WHERE c.track_id = t.id AND c.status = 'open')`,
        // Sons das tchekas (0133): os meus sons originais deixam de existir e de tocar (também nas tchekas de outros que os
        // usavam; o áudio sai do armazenamento com os outros ficheiros); as minhas tchekas deixam de estar ligadas a um som; as
        // denúncias de sons que fiz saem (e o som volta a poder ser usado se não houver outra por analisar). As tchekas de outros
        // que usavam os meus sons ficam sem som pouco depois (SoundsService.silencePending, de 10 em 10 minutos; 0140).
        "UPDATE content.sounds SET removed_at = coalesce(removed_at, now()), removed_reason = coalesce(removed_reason, 'Conta eliminada'), removed_by = coalesce(removed_by, 'account'), silenced_at = NULL, hold_at = NULL, audio_media_id = NULL WHERE owner_id = $1 AND kind = 'original'",
        'UPDATE content.posts SET sound_id = NULL WHERE author_id = $1 AND sound_id IS NOT NULL',
        'DELETE FROM content.sound_reports WHERE reporter_id = $1',
        `UPDATE content.sounds s SET hold_at = NULL WHERE $1::uuid IS NOT NULL AND s.hold_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM content.sound_reports r WHERE r.sound_id = s.id AND r.status = 'open')`,
      ]) await client.query(sql, [userId]);
      // As páginas de locais que eram suas passam para o administrador mais antigo; sem administrador, deixam de aparecer
      // (as consultas dos locais escondem páginas cujo dono foi eliminado).
      await client.query(
        `WITH heir AS (
           SELECT DISTINCT ON (m.venue_id) m.venue_id, m.user_id
             FROM content.venue_managers m JOIN content.venues v ON v.id = m.venue_id
            WHERE v.owner_id = $1 AND m.role = 'admin' AND m.status = 'active'
            ORDER BY m.venue_id, m.created_at
         ), moved AS (
           UPDATE content.venues v SET owner_id = heir.user_id FROM heir WHERE v.id = heir.venue_id RETURNING v.id, v.owner_id
         )
         DELETE FROM content.venue_managers m USING moved WHERE m.venue_id = moved.id AND m.user_id = moved.owner_id`,
        [userId],
      );
      // Os duetos que outras pessoas fizeram com as minhas tchekas levam o meu vídeo e o meu som gravados: ficam escondidos para
      // todos, como quando o autor do original os retira (0140). As respostas com tcheka só mostram o comentário e ficam.
      const duets = await client.query(
        `UPDATE content.posts d SET removed_at = now(), removed_by = 'original'
           FROM content.post_remixes rx JOIN content.posts o ON o.id = rx.original_id
          WHERE rx.post_id = d.id AND rx.kind = 'duet' AND o.author_id = $1 AND d.author_id <> $1 AND d.removed_at IS NULL
          RETURNING d.id`,
        [userId],
      );
      // Publicações deixam de existir para todos; as fotos passam a 'deleted' e são apagadas do armazenamento.
      await client.query(`UPDATE content.posts SET removed_at = now(), removed_by = 'author' WHERE author_id = $1 AND removed_at IS NULL`, [userId]);
      // A linha da publicação fica (presentes e reposts de outros apontam para ela), mas sem nada do que lá estava:
      // texto, sítio, música, temas, país, as fotos e as hashtags.
      await client.query(
        `UPDATE content.posts SET body = '', location_label = NULL, location_lat = NULL, location_lng = NULL, music = NULL, topics = NULL, country = NULL, geleira = NULL
          WHERE author_id = $1`,
        [userId],
      );
      await client.query('DELETE FROM content.post_media pm USING content.posts p WHERE pm.post_id = p.id AND p.author_id = $1', [userId]);
      await client.query('DELETE FROM content.post_tags t USING content.posts p WHERE t.post_id = p.id AND p.author_id = $1', [userId]);
      // Remix (0134): as ligações dos meus duetos e respostas (de que eram remix e onde ficava o autocolante).
      await client.query('DELETE FROM content.post_remixes rx USING content.posts p WHERE rx.post_id = p.id AND p.author_id = $1', [userId]);
      // A impressão da rede de quem entrou com um convite (antifraude) já não é precisa.
      await client.query('UPDATE social.referrals SET ip_hash = NULL WHERE invitee_id = $1', [userId]);
      await client.query(`UPDATE content.media_assets SET status = 'deleted' WHERE owner_id = $1 AND status <> 'deleted'`, [userId]);
      await client.query('DELETE FROM content.appeal_approved_photos WHERE owner_id = $1', [userId]);
      await client.query('DELETE FROM content.held_publications WHERE owner_id = $1', [userId]);
      // Segurança: as impressões (IP, rede, aparelho, email) saem já; os eventos ficam até ao prazo (90 dias), sem a conta.
      await client.query('UPDATE security.account_risk SET ip_hash = NULL, net_hash = NULL, device_hash = NULL, email_hash = NULL WHERE user_id = $1', [userId]);
      await client.query('UPDATE security.events SET user_id = NULL WHERE user_id = $1', [userId]);
      await this.audit(client, userId, auditAction);
      await client.query('COMMIT');
      this.indexer.userRemoved(userId);
      for (const d of duets.rows) this.indexer.postRemoved(d.id as string);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  private readonly countrySeen = new Map<string, string>();

  /** Regista o país atual da pessoa (a partir do IP). Sem país conhecido, mantém o último. Só vai à base de dados quando muda. */
  async touchCountry(userId: string, country: string | null) {
    if (!country || this.countrySeen.get(userId) === country) return;
    await this.pool.query('UPDATE identity.users SET country = $2 WHERE id = $1 AND country IS DISTINCT FROM $2', [userId, country]);
    if (this.countrySeen.size > 50_000) this.countrySeen.clear();
    this.countrySeen.set(userId, country);
  }

  /* ───── confirmação de e-mail e recuperação de senha ───── */

  /** Cria um código de uso único (guardamos só o hash). Os anteriores ainda por usar do mesmo tipo deixam de valer. */
  private async issueEmailToken(userId: string, kind: 'verify' | 'reset', ttlMs: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.pool.query("UPDATE identity.email_tokens SET used_at = now() WHERE user_id = $1 AND kind = $2 AND used_at IS NULL", [userId, kind]);
    await this.pool.query(
      'INSERT INTO identity.email_tokens (id, user_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, $4, now() + ($5 || \' milliseconds\')::interval)',
      [uuidv7(), userId, kind, sha256(token), String(ttlMs)],
    );
    return token;
  }

  /** Envia (ou reenvia) o e-mail de confirmação. Devolve false se o e-mail não está ligado ou a conta já está confirmada. */
  async sendVerification(userId: string): Promise<boolean> {
    if (!this.mail.enabled) return false;
    const { rows } = await this.pool.query("SELECT email, display_name, email_verified_at FROM identity.users WHERE id = $1 AND status = 'active'", [userId]);
    const u = rows[0];
    if (!u || u.email_verified_at) return false;
    const token = await this.issueEmailToken(userId, 'verify', 48 * 3600_000);
    return this.mail.send({ to: u.email, ...verifyEmailMail(this.mail.publicUrl, String(u.display_name).split(' ')[0], token) });
  }

  async emailStatus(userId: string) {
    const { rows } = await this.pool.query('SELECT email, email_verified_at IS NOT NULL AS verified FROM identity.users WHERE id = $1', [userId]);
    const verified = !!rows[0]?.verified;
    // O e-mail só vem enquanto falta ativar (para a pessoa ver se o escreveu bem).
    return { required: this.mail.enabled, verified, ...(verified || !rows[0] ? {} : { email: rows[0].email as string }) };
  }

  /**
   * Corrigir o e-mail enquanto a conta não está ativada (quem o escreveu mal no registo nunca receberia o link).
   * Depois de ativada, o e-mail não se muda por aqui. Manda logo o link para o e-mail novo.
   */
  async changeUnverifiedEmail(userId: string, raw: string) {
    const email = raw.trim().toLowerCase();
    const cur = (await this.pool.query("SELECT email, email_verified_at FROM identity.users WHERE id = $1 AND status = 'active'", [userId])).rows[0];
    if (!cur) throw new UnauthorizedException();
    if (cur.email_verified_at) throw new BadRequestException('A tua conta já está ativada');
    if (isDisposableEmail(email)) throw new BadRequestException('Usa um e-mail a sério (os temporários não dão)');
    if (email !== cur.email) {
      const taken = await this.pool.query('SELECT 1 FROM identity.users WHERE lower(email) = $1 AND id <> $2', [email, userId]);
      if (taken.rowCount) throw new ConflictException('Esse e-mail já está noutra conta');
      try {
        await this.pool.query('UPDATE identity.users SET email = $2 WHERE id = $1', [userId, email]);
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ConflictException('Esse e-mail já está noutra conta');
        throw e;
      }
      // Os links antigos (para o e-mail errado) deixam de valer.
      await this.pool.query("UPDATE identity.email_tokens SET used_at = now() WHERE user_id = $1 AND kind = 'verify' AND used_at IS NULL", [userId]).catch(() => undefined);
    }
    return { sent: await this.sendVerification(userId), email };
  }

  /** Abre o link do e-mail: marca a conta como confirmada. */
  async verifyEmail(token: string) {
    const { rows } = await this.pool.query(
      `UPDATE identity.email_tokens SET used_at = now()
        WHERE token_hash = $1 AND kind = 'verify' AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
      [sha256(token)],
    );
    if (!rows[0]) throw new BadRequestException('Este link já não vale. Pede um novo na app.');
    await this.pool.query('UPDATE identity.users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [rows[0].user_id]);
    return { ok: true };
  }

  /** "Esqueci a senha": responde sempre igual, exista ou não a conta (não revela quem está registado). */
  async forgotPassword(rawEmail: string, ctx: ReqContext = NO_CTX) {
    const email = rawEmail.trim().toLowerCase();
    await this.security.requireHuman(ctx, 'forgot');
    // No máximo 3 emails por hora para o mesmo endereço (a resposta é igual: não diz se travou nem se a conta existe).
    if (this.mail.enabled && z.string().email().max(254).safeParse(email).success && (await this.security.mailAllowed('reset', email, ctx))) {
      const { rows } = await this.pool.query("SELECT id, display_name FROM identity.users WHERE lower(email) = $1 AND status = 'active'", [email]);
      if (rows[0]) {
        const token = await this.issueEmailToken(rows[0].id, 'reset', 3600_000);
        await this.mail.send({ to: email, ...resetPasswordMail(this.mail.publicUrl, String(rows[0].display_name).split(' ')[0], token) });
      }
    }
    return { ok: true };
  }

  /** Define a senha nova com o código do e-mail. Termina todas as sessões. */
  async resetPassword(token: string, newPassword: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE identity.email_tokens SET used_at = now()
          WHERE token_hash = $1 AND kind = 'reset' AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
        [sha256(token)],
      );
      if (!rows[0]) throw new BadRequestException('Este link já não vale. Pede um novo em "Esqueci a senha".');
      const userId = rows[0].user_id as string;
      const hash = await this.hashPassword(newPassword);
      await client.query(
        `INSERT INTO identity.credentials (user_id, password_hash) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
        [userId, hash],
      );
      // Quem abriu o link provou que o e-mail é seu.
      await client.query('UPDATE identity.users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [userId]);
      await client.query('UPDATE identity.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      await this.audit(client, userId, 'auth.password_reset');
      await client.query('COMMIT');
      // Quem provou que o email é seu sai do bloqueio (é a saída para quem foi bloqueado por um ataque).
      const who = (await this.pool.query('SELECT email, username FROM identity.users WHERE id = $1', [userId])).rows[0];
      await this.security.unlockAccount(userId, [who?.email, who?.username]).catch(() => undefined);
      return { ok: true };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async verifyAccessToken(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { algorithms: ['HS256'], issuer: 'txillapp', audience: 'access' });
      if (!payload.sub) throw new Error('sem sub');
      return payload.sub;
    } catch {
      throw new UnauthorizedException();
    }
  }

  async getUser(id: string): Promise<SessionUser> {
    const { rows } = await this.pool.query(
      `SELECT id, username, display_name, verified, verified_tier FROM identity.users WHERE id = $1 AND status = 'active'`,
      [id],
    );
    if (!rows[0]) throw new UnauthorizedException();
    return sessionUser(rows[0]);
  }

  /* ───── avisos de segurança ───── */

  /** Já houve uma sessão nesta conta num aparelho com o mesmo nome? (sem sessões nenhumas, conta como conhecido: é o registo) */
  private async knownDevice(userId: string, userAgent?: string): Promise<boolean> {
    const label = describeDevice(userAgent).label;
    const { rows } = await this.pool.query(
      `SELECT DISTINCT user_agent FROM identity.sessions WHERE user_id = $1 AND created_at > now() - interval '180 days' LIMIT 100`,
      [userId],
    );
    return !rows.length || rows.some((r) => describeDevice(r.user_agent).label === label);
  }

  /** Para onde mandar um aviso: só emails confirmados (nunca para um email que alguém inventou no registo). */
  private async mailTarget(userId: string) {
    const u = (await this.pool.query("SELECT email, display_name, email_verified_at FROM identity.users WHERE id = $1 AND status = 'active'", [userId])).rows[0];
    return u && u.email_verified_at && !String(u.email).endsWith('.invalid') ? { email: u.email as string, name: String(u.display_name).split(' ')[0] } : null;
  }

  /** «Novo início de sessão»: um email (no máximo um em cada 10 minutos). Nunca falha o login. */
  private async noticeNewLogin(userId: string, userAgent: string | undefined, how: string, ctx: ReqContext) {
    try {
      const device = describeDevice(userAgent).label;
      void this.security.event('new_login', ctx, userId, { how });
      if (!this.mail.enabled || !(await this.security.once(`newlogin:${userId}`, LOGIN.NEW_LOGIN_EVERY_MS))) return;
      const t = await this.mailTarget(userId);
      if (t) await this.mail.send({ to: t.email, ...newLoginMail(this.mail.publicUrl, t.name, { at: new Date(), device, how }) });
    } catch {
      /* o aviso não pode estragar o login */
    }
  }

  /** «Alguém tentou entrar na tua conta»: um email quando a conta fica bloqueada (no máximo um em cada 6 horas). */
  private async warnLocked(userId: string, until: Date, ctx: ReqContext) {
    try {
      if (!this.mail.enabled || !(await this.security.once(`locked:${userId}`, LOGIN.WARN_EVERY_MS))) return;
      const t = await this.mailTarget(userId);
      if (t) await this.mail.send({ to: t.email, ...loginLockedMail(this.mail.publicUrl, t.name, { until, device: ctx.deviceLabel }) });
    } catch {
      /* nunca falha */
    }
  }

  /** Reutilização de um token de sessão já trocado: evento, métrica e um email ao dono (no máximo um por dia). */
  private async warnReuse(userId: string, familyId: string, userAgent: string | undefined, ctx: ReqContext) {
    try {
      const first = (await this.pool.query('SELECT user_agent FROM identity.sessions WHERE family_id = $1 ORDER BY created_at LIMIT 1', [familyId])).rows[0]?.user_agent as string | undefined;
      void this.security.event('refresh_reuse', ctx, userId, { family: familyId, from: describeDevice(userAgent).label });
      if (!this.mail.enabled || !(await this.security.once(`reuse:${userId}`, 24 * 3600_000))) return;
      const t = await this.mailTarget(userId);
      if (t) await this.mail.send({ to: t.email, ...sessionReuseMail(this.mail.publicUrl, t.name, { at: new Date(), device: describeDevice(first).label }) });
    } catch {
      /* nunca falha */
    }
  }

  private getDummyHash() {
    return (this.dummyHash ??= argon2.hash(randomBytes(16).toString('hex'), ARGON_OPTS));
  }

  private async issueSession(client: PoolClient, userId: string, familyId: string, userAgent?: string): Promise<Tokens> {
    const refreshToken = randomBytes(32).toString('base64url');
    await client.query(
      `INSERT INTO identity.sessions (id, user_id, family_id, token_hash, expires_at, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuidv7(), userId, familyId, sha256(refreshToken), new Date(Date.now() + REFRESH_TTL_MS), userAgent?.slice(0, 300) ?? null],
    );
    const accessToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer('txillapp')
      .setAudience('access')
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_S}s`)
      .sign(this.secret);
    return { accessToken, refreshToken };
  }

  private audit(client: PoolClient, actorId: string, action: string, target?: string) {
    return client.query('INSERT INTO audit.audit_log (id, actor_id, action, target) VALUES ($1, $2, $3, $4)', [
      uuidv7(),
      actorId,
      action,
      target ?? null,
    ]);
  }
}

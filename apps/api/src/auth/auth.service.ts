import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { LoginInput, PublicUser, RegisterInput, usernameSchema, TERMS_VERSION } from '@txillapp/shared';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { hashNet, isDisposable } from '../invites/rules';
import { SearchIndexer } from '../search/search-index';
import { PG_POOL } from '../db/db.module';
import { MailService } from '../mail/mail.service';
import { resetPasswordMail, verifyEmailMail } from '../mail/templates';
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

/** "Chrome · Windows" a partir do user-agent (só para mostrar a lista de dispositivos). */
function describeDevice(ua?: string | null): string {
  if (!ua) return 'Dispositivo desconhecido';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Dispositivo';
  return `${browser} · ${os}`;
}

@Injectable()
export class AuthService {
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
  ) {
    this.secret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
    this.netSalt = config.JWT_ACCESS_SECRET.slice(0, 16);
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

  async register(input: RegisterInput, userAgent?: string, ip?: string) {
    if (isReservedUsername(input.username)) throw new ConflictException('Esse nome está reservado');
    const id = uuidv7();
    const hash = await argon2.hash(input.password, ARGON_OPTS);
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
      const tokens = await this.issueSession(client, id, uuidv7(), userAgent);
      await client.query('COMMIT');
      this.indexer.userChanged(id);
      void this.sendVerification(id).catch(() => undefined);
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

  async login(input: LoginInput, userAgent?: string) {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.username, u.display_name, u.status, c.password_hash
         FROM identity.users u JOIN identity.credentials c ON c.user_id = u.id
        WHERE u.email = $1 OR u.username = $1`,
      [input.identifier],
    );
    const row = rows[0];
    const ok = await argon2.verify(row?.password_hash ?? (await this.getDummyHash()), input.password);
    if (!row || !ok || row.status !== 'active') {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tokens = await this.issueSession(client, row.id, uuidv7(), userAgent);
      await this.audit(client, row.id, 'auth.login');
      await client.query('COMMIT');
      return { tokens, user: { id: row.id, username: row.username, displayName: row.display_name } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /** Rotação: cada refresh token só é usado uma vez; reutilização revoga toda a família. */
  async refresh(refreshToken: string, userAgent?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT s.id, s.user_id, s.family_id, s.expires_at, s.used_at, s.revoked_at,
                u.username, u.display_name, u.status
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
        throw new UnauthorizedException();
      }
      if (new Date(s.expires_at) < new Date() || s.status !== 'active') throw new UnauthorizedException();
      await client.query('UPDATE identity.sessions SET used_at = COALESCE(used_at, now()) WHERE id = $1', [s.id]);
      const tokens = await this.issueSession(client, s.user_id, s.family_id, userAgent);
      await client.query('COMMIT');
      return { tokens, user: { id: s.user_id, username: s.username, displayName: s.display_name } as PublicUser };
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
  async googleLogin(idToken: string, userAgent?: string) {
    const p = await this.google.verify(idToken);
    const found = await this.pool.query(
      `SELECT id, username, display_name, status FROM identity.users WHERE google_sub = $1`,
      [p.sub],
    );
    const u = found.rows[0];
    if (u) {
      if (u.status !== 'active') throw new UnauthorizedException('Conta indisponível');
      const tokens = await this.sessionFor(u.id, 'auth.google_login', userAgent);
      return { kind: 'session' as const, tokens, user: { id: u.id, username: u.username, displayName: u.display_name } };
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

  async googleComplete(signupToken: string, rawUsername: string, userAgent?: string, gender?: string, birthDate?: string) {
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
      const tokens = await this.issueSession(client, id, uuidv7(), userAgent);
      await client.query('COMMIT');
      this.indexer.userChanged(id);
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
  async appleLogin(identityToken: string, nonce: string | undefined, fullName: string | undefined, userAgent?: string) {
    const p = await this.apple.verify(identityToken, nonce);
    const found = await this.pool.query(`SELECT id, username, display_name, status FROM identity.users WHERE apple_sub = $1`, [p.sub]);
    const u = found.rows[0];
    if (u) {
      if (u.status !== 'active') throw new UnauthorizedException('Conta indisponível');
      const tokens = await this.sessionFor(u.id, 'auth.apple_login', userAgent);
      return { kind: 'session' as const, tokens, user: { id: u.id, username: u.username, displayName: u.display_name } };
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

  async appleComplete(signupToken: string, rawUsername: string, userAgent?: string, gender?: string, birthDate?: string) {
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
      const tokens = await this.issueSession(client, id, uuidv7(), userAgent);
      await client.query('COMMIT');
      this.indexer.userChanged(id);
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
    if (!(await argon2.verify(rows[0].password_hash, current))) throw new UnauthorizedException('A senha atual não está certa');
    if (current === next) throw new BadRequestException('A nova senha tem de ser diferente da atual');
    const hash = await argon2.hash(next, ARGON_OPTS);
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

  /** Dispositivos com sessão iniciada (um por "família" de refresh tokens). */
  async sessions(userId: string, currentRefreshToken?: string) {
    const current = currentRefreshToken
      ? (await this.pool.query('SELECT family_id FROM identity.sessions WHERE token_hash = $1 AND user_id = $2', [sha256(currentRefreshToken), userId])).rows[0]?.family_id
      : undefined;
    const { rows } = await this.pool.query(
      `SELECT family_id, min(created_at) AS first_seen, max(created_at) AS last_used,
              (array_agg(user_agent ORDER BY created_at DESC))[1] AS ua
         FROM identity.sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        GROUP BY family_id ORDER BY max(created_at) DESC LIMIT 30`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.family_id as string,
      device: describeDevice(r.ua),
      firstSeen: r.first_seen,
      lastUsed: r.last_used,
      current: r.family_id === current,
    }));
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
    if (u.password_hash && !(password && (await argon2.verify(u.password_hash, password)))) {
      throw new UnauthorizedException('A senha não está certa');
    }
    // Sai dos TxillGroups como quem sai pelo próprio pé: passa a administração, e um grupo que fica vazio devolve o cofre e fecha.
    // (O serviço dos grupos vive no módulo do chat, que já depende deste; vai-se buscá-lo só aqui, sem criar um ciclo.)
    const groups = (await this.pool.query('SELECT group_id FROM social.group_members WHERE user_id = $1', [userId])).rows;
    if (groups.length) {
      const { GroupsService } = await import('../chat/groups.service');
      const svc = this.moduleRef.get(GroupsService, { strict: false });
      for (const g of groups) await svc.removeMember(userId, g.group_id as string, String(u.username)).catch(() => undefined);
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE identity.users SET status = 'deleted', username = 'eliminado_' || substr(replace(id::text, '-', ''), 1, 12),
                display_name = 'Conta eliminada', email = 'deleted+' || id::text || '@invalid.local',
                bio = NULL, google_sub = NULL, apple_sub = NULL, avatar_media_id = NULL, is_private = true, gender = NULL, birth_date = NULL
          WHERE id = $1`,
        [userId],
      );
      await client.query('DELETE FROM identity.credentials WHERE user_id = $1', [userId]);
      await client.query('UPDATE identity.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      await client.query('DELETE FROM social.follows WHERE follower_id = $1 OR followee_id = $1', [userId]);
      await client.query('DELETE FROM social.follow_requests WHERE requester_id = $1 OR target_id = $1', [userId]);
      await client.query('DELETE FROM social.suggestion_dismissals WHERE user_id = $1 OR dismissed_id = $1', [userId]);
      await client.query('DELETE FROM social.story_hidden WHERE owner_id = $1 OR hidden_id = $1', [userId]);
      await client.query('DELETE FROM taste.user_items WHERE user_id = $1', [userId]);
      // Brindes à geleira, dados e recebidos (a conta só fica anonimizada, por isso o CASCADE não chega).
      await client.query('DELETE FROM taste.geleira_cheers WHERE owner_id = $1 OR user_id = $1', [userId]);
      await client.query('DELETE FROM taste.geleira_cheer_notices WHERE owner_id = $1 OR user_id = $1', [userId]);
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
        'DELETE FROM content.cheers WHERE user_id = $1',
        'DELETE FROM content.comment_cheers WHERE user_id = $1',
        // Quem já foi contado nos avisos de brindes (dados e recebidos) e o travão desses avisos no telemóvel.
        'DELETE FROM social.cheer_notices WHERE user_id = $1 OR owner_id = $1',
        'DELETE FROM social.cheer_pushes WHERE user_id = $1',
        'DELETE FROM content.story_views WHERE viewer_id = $1',
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
      // Publicações deixam de existir para todos; as fotos passam a 'deleted' e são apagadas do armazenamento.
      await client.query(`UPDATE content.posts SET removed_at = now(), removed_by = 'author' WHERE author_id = $1 AND removed_at IS NULL`, [userId]);
      await client.query(`UPDATE content.media_assets SET status = 'deleted' WHERE owner_id = $1 AND status <> 'deleted'`, [userId]);
      await this.audit(client, userId, 'account.deleted');
      await client.query('COMMIT');
      this.indexer.userRemoved(userId);
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
    if (isDisposable(email)) throw new BadRequestException('Usa um e-mail a sério (os temporários não dão)');
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
  async forgotPassword(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    if (this.mail.enabled && z.string().email().max(254).safeParse(email).success) {
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
      const hash = await argon2.hash(newPassword, ARGON_OPTS);
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

  async getUser(id: string): Promise<PublicUser> {
    const { rows } = await this.pool.query(
      `SELECT id, username, display_name FROM identity.users WHERE id = $1 AND status = 'active'`,
      [id],
    );
    if (!rows[0]) throw new UnauthorizedException();
    return { id: rows[0].id, username: rows[0].username, displayName: rows[0].display_name };
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

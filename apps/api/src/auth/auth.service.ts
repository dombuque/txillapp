import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { Pool, PoolClient } from 'pg';
import { LoginInput, PublicUser, RegisterInput } from '@txillapp/shared';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';

const ACCESS_TTL_S = 10 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  private readonly secret: Uint8Array;
  // Hash falso para igualar o tempo de resposta quando o utilizador não existe.
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) config: AppConfig,
  ) {
    this.secret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
  }

  async register(input: RegisterInput, userAgent?: string) {
    const id = uuidv7();
    const hash = await argon2.hash(input.password, ARGON_OPTS);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO identity.users (id, email, username, display_name) VALUES ($1, $2, $3, $4)',
        [id, input.email, input.username, input.displayName],
      );
      await client.query('INSERT INTO identity.credentials (user_id, password_hash) VALUES ($1, $2)', [id, hash]);
      await this.audit(client, id, 'auth.register');
      const tokens = await this.issueSession(client, id, uuidv7(), userAgent);
      await client.query('COMMIT');
      return { tokens, user: { id, username: input.username, displayName: input.displayName } };
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException('Email ou nome de utilizador já em uso');
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async login(input: LoginInput, userAgent?: string) {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.username, u.display_name, u.status, c.password_hash
         FROM identity.users u JOIN identity.credentials c ON c.user_id = u.id
        WHERE u.email = $1`,
      [input.email],
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
      if (s.used_at || s.revoked_at) {
        await client.query('UPDATE identity.sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [s.family_id]);
        await this.audit(client, s.user_id, 'auth.refresh_reuse_detected', s.family_id);
        await client.query('COMMIT');
        throw new UnauthorizedException();
      }
      if (new Date(s.expires_at) < new Date() || s.status !== 'active') throw new UnauthorizedException();
      await client.query('UPDATE identity.sessions SET used_at = now() WHERE id = $1', [s.id]);
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

  async verifyAccessToken(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { algorithms: ['HS256'], issuer: 'txillapp' });
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

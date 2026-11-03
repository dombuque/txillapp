import { Inject, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from 'jose';
import { AppConfig, CONFIG } from '../config';

export const APPLE_JWKS = Symbol('APPLE_JWKS');

export interface AppleProfile {
  sub: string;
  /** Pode ser um email de reencaminhamento privado da Apple (@privaterelay.appleid.com). */
  email: string | null;
  isPrivateEmail: boolean;
}

/**
 * Verifica no servidor o "identity token" do Iniciar sessão com a Apple (assinatura, emissor, destinatário, validade e, se a
 * app enviou um nonce, que bate certo). O destinatário é o identificador da app (bundle ID) ou do serviço web.
 */
@Injectable()
export class AppleService {
  private readonly clientIds: string[];
  private readonly jwks: JWTVerifyGetKey;

  constructor(
    @Inject(CONFIG) config: AppConfig,
    @Optional() @Inject(APPLE_JWKS) jwks?: JWTVerifyGetKey | null,
  ) {
    this.clientIds = (config.APPLE_CLIENT_ID ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    this.jwks = jwks ?? createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
  }

  get enabled() {
    return this.clientIds.length > 0;
  }

  async verify(identityToken: string, nonce?: string): Promise<AppleProfile> {
    if (!this.enabled) throw new ServiceUnavailableException('O login com a Apple não está configurado');
    try {
      const { payload } = await jwtVerify(identityToken, this.jwks, { issuer: 'https://appleid.apple.com', audience: this.clientIds, algorithms: ['RS256'] });
      if (!payload.sub) throw new Error('sem sub');
      // Se a app mandou um nonce, o token traz o SHA-256 dele (ou o próprio nonce).
      if (nonce) {
        const hashed = createHash('sha256').update(nonce).digest('hex');
        if (payload.nonce !== nonce && payload.nonce !== hashed) throw new Error('nonce não bate');
      }
      const verified = payload.email_verified === true || payload.email_verified === 'true';
      const email = typeof payload.email === 'string' && verified ? payload.email.toLowerCase() : null;
      return { sub: payload.sub, email, isPrivateEmail: payload.is_private_email === true || payload.is_private_email === 'true' };
    } catch {
      throw new UnauthorizedException('Não consegui validar a tua conta Apple');
    }
  }
}

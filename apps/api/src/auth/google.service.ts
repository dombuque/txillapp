import { Inject, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from 'jose';
import { AppConfig, CONFIG } from '../config';

export const GOOGLE_JWKS = Symbol('GOOGLE_JWKS');

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
}

/** Verifica no servidor o ID token da Google (assinatura, emissor, destinatário, validade e email verificado). */
@Injectable()
export class GoogleService {
  private readonly clientId?: string;
  private readonly jwks: JWTVerifyGetKey;

  constructor(
    @Inject(CONFIG) config: AppConfig,
    @Optional() @Inject(GOOGLE_JWKS) jwks?: JWTVerifyGetKey | null,
  ) {
    this.clientId = config.GOOGLE_CLIENT_ID;
    this.jwks = jwks ?? createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  }

  get clientIdPublic(): string | null {
    return this.clientId ?? null;
  }

  async verify(idToken: string): Promise<GoogleProfile> {
    if (!this.clientId) throw new ServiceUnavailableException('O login com Google não está configurado');
    try {
      const { payload } = await jwtVerify(idToken, this.jwks, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: this.clientId,
        algorithms: ['RS256'],
      });
      if (!payload.sub || typeof payload.email !== 'string' || payload.email_verified !== true) {
        throw new Error('perfil incompleto ou email não verificado');
      }
      return { sub: payload.sub, email: payload.email.toLowerCase(), name: typeof payload.name === 'string' && payload.name ? payload.name : payload.email.split('@')[0] };
    } catch {
      throw new UnauthorizedException('Não consegui validar a tua conta Google');
    }
  }
}

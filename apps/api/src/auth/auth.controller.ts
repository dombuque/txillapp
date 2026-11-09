import { Reflector } from '@nestjs/core';
import { NEEDS } from '../staff/staff.guard';
import {
  Body, CanActivate, Controller, Delete, ExecutionContext, Get, HttpCode, Injectable, Param, ParseUUIDPipe,
  Post, Query, Req, Res, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Request, Response } from 'express';
import { AuthResponse, LoginInput, RegisterInput, genderSchema, loginSchema, passwordSchema, registerSchema, birthDateSchema } from '@txillapp/shared';
import { ZodPipe } from '../common/zod.pipe';
import { countryOf } from '../common/geo';
import { AuthService, REFRESH_TTL_MS, Tokens } from './auth.service';

const COOKIE = 'txill_rt';
const COOKIE_PATH = '/api/v1/auth';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext) {
    // Rotas da equipa do backoffice (@Needs): têm o seu próprio login, separado da rede social.
    if (this.reflector.getAllAndOverride(NEEDS, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    req.userId = await this.auth.verifyAccessToken(header.slice(7));
    // Cada país é a sua rede: guarda onde a pessoa está agora (só escreve se mudou).
    await this.auth.touchCountry(req.userId, countryOf(req));
    return true;
  }
}

/** Defesa CSRF adicional para endpoints que usam o cookie: exige um cabeçalho que um <form> não consegue enviar. */
function requireCsrfHeader(req: Request) {
  if (req.headers['x-requested-with'] !== 'txillapp') throw new UnauthorizedException();
}

/**
 * App nativa (React Native no telemóvel): não usa cookies. Envia `X-Client: txillapp-mobile`, recebe o token de renovação no
 * corpo da resposta (para guardar no cofre do telemóvel) e devolve-o no cabeçalho `X-Refresh-Token`.
 *
 * App no browser (`X-Client: txillapp-web`): o token de renovação nunca chega ao JavaScript da página. Fica num cookie HttpOnly
 * por conta (`txill_rt_<id>`, só para /api/v1/auth, SameSite=Strict), e a página diz qual conta quer renovar com `X-Account`.
 * Assim um script malicioso na página não consegue roubar sessões, e as várias contas no mesmo browser continuam a funcionar.
 */
const isMobile = (req: Request) => req.headers['x-client'] === 'txillapp-mobile';
const isWebApp = (req: Request) => req.headers['x-client'] === 'txillapp-web';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const accountCookie = (userId: string) => `${COOKIE}_${userId}`;
const accountOf = (req: Request): string | null => {
  const a = req.headers['x-account'];
  return typeof a === 'string' && UUID.test(a) ? a : null;
};
const headerToken = (req: Request): string | undefined => {
  const h = req.headers['x-refresh-token'];
  return typeof h === 'string' && h.length >= 20 && h.length <= 400 ? h : undefined;
};
const refreshTokenOf = (req: Request): string | undefined => {
  if (isMobile(req)) return headerToken(req) ?? ((req.cookies?.[COOKIE] as string | undefined) || undefined);
  if (isWebApp(req)) {
    const acc = accountOf(req);
    const own = acc ? (req.cookies?.[accountCookie(acc)] as string | undefined) : undefined;
    if (own) return own;
    // Migração (uma vez por conta): o token que a página ainda tinha guardado passa para o cookie e é apagado lá.
    const legacy = headerToken(req);
    if (legacy) return legacy;
  }
  return (req.cookies?.[COOKIE] as string | undefined) || undefined;
};
/** Apaga o cookie desta sessão (o da conta, no browser, e o antigo do site). */
const clearSessionCookies = (req: Request, res: Response) => {
  const acc = accountOf(req);
  if (acc) res.clearCookie(accountCookie(acc), { path: COOKIE_PATH });
  res.clearCookie(COOKIE, { path: COOKIE_PATH });
};

const passwordChangeSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema });
const deleteSchema = z.object({ confirmUsername: z.string().min(1).max(60), password: z.string().max(128).optional() });
const tokenSchema = z.object({ token: z.string().min(20).max(200) });
const forgotSchema = z.object({ email: z.string().max(254) });
const resetSchema = z.object({ token: z.string().min(20).max(200), newPassword: passwordSchema });
const googleSchema = z.object({ idToken: z.string().min(20).max(4096) });
const appleSchema = z.object({ identityToken: z.string().min(20).max(8192), nonce: z.string().max(200).optional(), fullName: z.string().max(120).optional() });
const appleCompleteSchema = z.object({ signupToken: z.string().min(20).max(4096), username: z.string().min(1).max(60), gender: genderSchema.optional(), birthDate: birthDateSchema.optional() });
const googleCompleteSchema = z.object({ signupToken: z.string().min(20).max(4096), username: z.string().min(1).max(60), gender: genderSchema.optional(), birthDate: birthDateSchema, acceptTerms: z.literal(true) });

@Controller('auth')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(
    @Body(new ZodPipe(registerSchema)) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { tokens, user } = await this.auth.register(body, req.headers['user-agent'], req.ip);
    return this.respond(res, tokens, user);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { tokens, user } = await this.auth.login(body, req.headers['user-agent']);
    return this.respond(res, tokens, user);
  }

  // A renovação corre sempre que se abre a app/separador: limite próprio, mais largo que o do login.
  @Post('refresh')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    requireCsrfHeader(req);
    const token = refreshTokenOf(req);
    if (!token) throw new UnauthorizedException();
    try {
      const { tokens, user } = await this.auth.refresh(token, req.headers['user-agent']);
      return this.respond(res, tokens, user);
    } catch (e) {
      // Só se apaga o cookie quando o token é mesmo inválido; um erro temporário não pode deslogar ninguém.
      if (e instanceof UnauthorizedException) clearSessionCookies(req, res);
      throw e;
    }
  }

  /** Configuração pública para o cliente (o ID de cliente da Google não é segredo). */
  @Get('config')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  config() {
    return { googleClientId: this.auth.googleClientId, appleEnabled: !!this.auth.appleClientId };
  }

  /** Verificação ao escrever o @ no registo. Limitada para dificultar a enumeração de utilizadores. */
  @Get('username-available')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  usernameAvailable(@Query('username') username = '') {
    return this.auth.usernameAvailable(username.slice(0, 60));
  }

  @Get('email-available')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  emailAvailable(@Query('email') email = '') {
    return this.auth.emailAvailable(email.slice(0, 254));
  }

  @Post('google')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  async google(
    @Body(new ZodPipe(googleSchema)) body: z.infer<typeof googleSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.googleLogin(body.idToken, req.headers['user-agent']);
    if (r.kind === 'session') return this.respond(res, r.tokens, r.user);
    return { needsUsername: true as const, signupToken: r.signupToken, displayName: r.displayName, suggestedUsername: r.suggestedUsername };
  }

  @Post('apple')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  async apple(
    @Body(new ZodPipe(appleSchema)) body: z.infer<typeof appleSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.appleLogin(body.identityToken, body.nonce, body.fullName, req.headers['user-agent']);
    if (r.kind === 'session') return this.respond(res, r.tokens, r.user);
    return { needsUsername: true as const, signupToken: r.signupToken, displayName: r.displayName, suggestedUsername: r.suggestedUsername };
  }

  @Post('apple/complete')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  async appleComplete(
    @Body(new ZodPipe(appleCompleteSchema)) body: z.infer<typeof appleCompleteSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { tokens, user } = await this.auth.appleComplete(body.signupToken, body.username, req.headers['user-agent'], body.gender, body.birthDate);
    return this.respond(res, tokens, user);
  }

  @Post('google/complete')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  async googleComplete(
    @Body(new ZodPipe(googleCompleteSchema)) body: z.infer<typeof googleCompleteSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { tokens, user } = await this.auth.googleComplete(body.signupToken, body.username, req.headers['user-agent'], body.gender, body.birthDate);
    return this.respond(res, tokens, user);
  }

  @Post('logout')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    requireCsrfHeader(req);
    const token = refreshTokenOf(req);
    if (token) await this.auth.logout(token);
    clearSessionCookies(req, res);
  }

  /* ───── segurança da conta ───── */

  @Post('password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @Req() req: Request & { userId?: string },
    @Body(new ZodPipe(passwordChangeSchema)) b: z.infer<typeof passwordChangeSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { tokens, user } = await this.auth.changePassword(req.userId!, b.currentPassword, b.newPassword, req.headers['user-agent']);
    return this.respond(res, tokens, user); // sessão nova para este dispositivo; as outras terminam
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  sessions(@Req() req: Request & { userId?: string }) {
    return this.auth.sessions(req.userId!, refreshTokenOf(req));
  }

  @Post('sessions/revoke-others')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  revokeOthers(@Req() req: Request & { userId?: string }) {
    return this.auth.revokeOtherSessions(req.userId!, refreshTokenOf(req));
  }

  @Delete('sessions/:family')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  revoke(@Req() req: Request & { userId?: string }, @Param('family', ParseUUIDPipe) family: string) {
    return this.auth.revokeSession(req.userId!, family);
  }

  @Post('delete-account')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async deleteAccount(
    @Req() req: Request & { userId?: string },
    @Body(new ZodPipe(deleteSchema)) b: z.infer<typeof deleteSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.deleteAccount(req.userId!, b.confirmUsername, b.password);
    res.clearCookie(accountCookie(req.userId!), { path: COOKIE_PATH });
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
  }

  /* ───── e-mail ───── */

  /** Esta conta precisa de confirmar o e-mail? (a app mostra um aviso) */
  @Get('email/status')
  @UseGuards(JwtAuthGuard)
  emailStatus(@Req() req: Request & { userId?: string }) {
    return this.auth.emailStatus(req.userId!);
  }

  /** Reenvia o e-mail de confirmação. */
  @Post('email/resend')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 3600_000 } })
  async resend(@Req() req: Request & { userId?: string }) {
    return { sent: await this.auth.sendVerification(req.userId!) };
  }

  /** Corrigir o e-mail enquanto a conta não está ativada (e reenviar o link para o novo). */
  @Post('email/change')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  changeEmail(@Req() req: Request & { userId?: string }, @Body(new ZodPipe(z.object({ email: z.string().trim().email().max(254) }))) b: { email: string }) {
    return this.auth.changeUnverifiedEmail(req.userId!, b.email);
  }

  /** O link do e-mail leva aqui. Público: quem abre o link pode estar noutro aparelho. */
  @Post('email/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  verifyEmail(@Body(new ZodPipe(tokenSchema)) b: z.infer<typeof tokenSchema>) {
    return this.auth.verifyEmail(b.token);
  }

  @Post('password/forgot')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  forgot(@Body(new ZodPipe(forgotSchema)) b: z.infer<typeof forgotSchema>) {
    return this.auth.forgotPassword(b.email);
  }

  @Post('password/reset')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  reset(@Body(new ZodPipe(resetSchema)) b: z.infer<typeof resetSchema>) {
    return this.auth.resetPassword(b.token, b.newPassword);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request & { userId?: string }) {
    return this.auth.getUser(req.userId!);
  }

  private respond(res: Response, tokens: Tokens, user: AuthResponse['user']): AuthResponse {
    const req = res.req;
    // A app nativa guarda o token ela própria (e pode ter várias contas): não leva cookie, e um cookie antigo do site é apagado.
    if (req && isMobile(req)) {
      res.clearCookie(COOKIE, { path: COOKIE_PATH });
      return { accessToken: tokens.accessToken, user, refreshToken: tokens.refreshToken } as AuthResponse;
    }
    const opts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: COOKIE_PATH, maxAge: REFRESH_TTL_MS };
    if (req && isWebApp(req)) {
      // Browser: um cookie por conta; o token nunca vai no corpo da resposta.
      res.cookie(accountCookie(user.id), tokens.refreshToken, opts);
      res.clearCookie(COOKIE, { path: COOKIE_PATH });
    } else {
      res.cookie(COOKIE, tokens.refreshToken, opts);
    }
    return { accessToken: tokens.accessToken, user };
  }

}

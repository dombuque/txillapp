import {
  Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Injectable,
  Post, Query, Req, Res, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Request, Response } from 'express';
import { AuthResponse, LoginInput, RegisterInput, loginSchema, registerSchema } from '@txillapp/shared';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService, REFRESH_TTL_MS, Tokens } from './auth.service';

const COOKIE = 'txill_rt';
const COOKIE_PATH = '/api/v1/auth';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    req.userId = await this.auth.verifyAccessToken(header.slice(7));
    return true;
  }
}

/** Defesa CSRF adicional para endpoints que usam o cookie: exige um cabeçalho que um <form> não consegue enviar. */
function requireCsrfHeader(req: Request) {
  if (req.headers['x-requested-with'] !== 'txillapp') throw new UnauthorizedException();
}

const googleSchema = z.object({ idToken: z.string().min(20).max(4096) });
const googleCompleteSchema = z.object({ signupToken: z.string().min(20).max(4096), username: z.string().min(1).max(60) });

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
    const { tokens, user } = await this.auth.register(body, req.headers['user-agent']);
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
    const token = req.cookies?.[COOKIE];
    if (!token) throw new UnauthorizedException();
    try {
      const { tokens, user } = await this.auth.refresh(token, req.headers['user-agent']);
      return this.respond(res, tokens, user);
    } catch (e) {
      // Só se apaga o cookie quando o token é mesmo inválido; um erro temporário não pode deslogar ninguém.
      if (e instanceof UnauthorizedException) res.clearCookie(COOKIE, { path: COOKIE_PATH });
      throw e;
    }
  }

  /** Configuração pública para o cliente (o ID de cliente da Google não é segredo). */
  @Get('config')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  config() {
    return { googleClientId: this.auth.googleClientId };
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

  @Post('google/complete')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  async googleComplete(
    @Body(new ZodPipe(googleCompleteSchema)) body: z.infer<typeof googleCompleteSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { tokens, user } = await this.auth.googleComplete(body.signupToken, body.username, req.headers['user-agent']);
    return this.respond(res, tokens, user);
  }

  @Post('logout')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    requireCsrfHeader(req);
    const token = req.cookies?.[COOKIE];
    if (token) await this.auth.logout(token);
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request & { userId?: string }) {
    return this.auth.getUser(req.userId!);
  }

  private respond(res: Response, tokens: Tokens, user: AuthResponse['user']): AuthResponse {
    res.cookie(COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: COOKIE_PATH,
      maxAge: REFRESH_TTL_MS,
    });
    return { accessToken: tokens.accessToken, user };
  }
}

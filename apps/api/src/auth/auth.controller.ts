import {
  Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Injectable,
  Post, Req, Res, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthResponse, LoginInput, RegisterInput, loginSchema, registerSchema } from '@txillapp/shared';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService, Tokens } from './auth.service';

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

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    requireCsrfHeader(req);
    const token = req.cookies?.[COOKIE];
    if (!token) throw new UnauthorizedException();
    try {
      const { tokens, user } = await this.auth.refresh(token, req.headers['user-agent']);
      return this.respond(res, tokens, user);
    } catch (e) {
      res.clearCookie(COOKIE, { path: COOKIE_PATH });
      throw e;
    }
  }

  @Post('logout')
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
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    return { accessToken: tokens.accessToken, user };
  }
}

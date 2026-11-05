import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { StaffAuthService } from './staff-auth.service';
import { StaffGuard } from './staff.guard';

type StaffReq = Request & { userId?: string; staffAccountId?: string };

const loginSchema = z.object({ email: z.string().trim().min(3).max(254), password: z.string().min(1).max(200), code: z.string().trim().min(6).max(8) });
const setupSchema = z.object({ token: z.string().min(20).max(200), password: z.string().min(12).max(200), code: z.string().trim().min(6).max(8) });

/** Entrada da equipa do backoffice (separada da rede social). */
@Controller('staff-auth')
export class StaffAuthController {
  constructor(private readonly auth: StaffAuthService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body(new ZodPipe(loginSchema)) b: z.infer<typeof loginSchema>) {
    return this.auth.login(b.email, b.password, b.code);
  }

  /** Abrir a ligação de convite: mostra o email e o QR dos dois passos. */
  @Get('setup')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  setupInfo(@Query('token') token = '') {
    return this.auth.setupInfo(token);
  }

  @Post('setup')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  setup(@Body(new ZodPipe(setupSchema)) b: z.infer<typeof setupSchema>) {
    return this.auth.setupComplete(b.token, b.password, b.code);
  }

  @Get('me')
  @UseGuards(StaffGuard)
  me(@Req() req: StaffReq) {
    return this.auth.info(req.staffAccountId!);
  }

  /** Sair de todo o lado. */
  @Post('logout')
  @HttpCode(204)
  @UseGuards(StaffGuard)
  logout(@Req() req: StaffReq) {
    return this.auth.logoutEverywhere(req.staffAccountId!);
  }
}

import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { VERIFIED_TIERS } from '../common/badge';
import { ZodPipe } from '../common/zod.pipe';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { StaffAuthService } from '../staff/staff-auth.service';
import { StaffService, TEAMS } from '../staff/staff.service';
import { BackofficeService } from './backoffice.service';

type AuthedReq = Request & { userId?: string };

const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Escreve o motivo').max(300) });
const badgeSchema = z.object({ tier: z.enum(VERIFIED_TIERS).nullable(), reason: z.string().trim().min(3, 'Escreve o motivo').max(300) });
const noteSchema =z.object({ body: z.string().trim().min(1).max(1000) });
const teamIds = TEAMS.map((t) => t.id) as [string, ...string[]];
const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), name: z.string().trim().min(1).max(80), teams: z.array(z.enum(teamIds)).min(1) });
const teamsSchema = z.object({ teams: z.array(z.enum(teamIds)).min(1), reason: z.string().trim().min(3).max(300) });
const activeSchema = z.object({ active: z.boolean(), reason: z.string().trim().min(3).max(300) });

/** Backoffice (computador): só contas de moderação. */
@Controller('admin')
@UseGuards(StaffGuard)
export class BackofficeController {
  constructor(private readonly bo: BackofficeService, private readonly staff: StaffService, private readonly staffAuth: StaffAuthService) {}

  /** Quem sou: equipas e permissões (para o menu). */
  @Get('me')
  me(@Req() req: AuthedReq) {
    return this.staff.me(req.userId!);
  }

  /** A equipa: as contas de equipa (separadas da rede social). */
  @Get('staff')
  @Needs('staff.manage')
  team() {
    return this.staffAuth.list();
  }

  /** Convida uma pessoa: cria a conta e devolve a ligação de uso único para definir a senha e os dois passos. */
  @Post('staff/invite')
  @Needs('staff.manage')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  invite(@Req() req: AuthedReq, @Body(new ZodPipe(inviteSchema)) b: z.infer<typeof inviteSchema>) {
    return this.staffAuth.invite(req.userId!, b);
  }

  @Post('staff/:id/teams')
  @Needs('staff.manage')
  @HttpCode(204)
  setTeams(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(teamsSchema)) b: z.infer<typeof teamsSchema>) {
    return this.staffAuth.setTeams(req.userId!, id, b.teams, b.reason);
  }

  @Post('staff/:id/active')
  @Needs('staff.manage')
  @HttpCode(204)
  setActive(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(activeSchema)) b: z.infer<typeof activeSchema>) {
    return this.staffAuth.setActive(req.userId!, id, b.active, b.reason);
  }

  /** Repor o acesso (perdeu a senha ou o telemóvel): nova ligação de configuração. */
  @Post('staff/:id/reset')
  @Needs('staff.manage')
  @HttpCode(200)
  reset(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) b: z.infer<typeof reasonSchema>) {
    return this.staffAuth.resetAccess(req.userId!, id, b.reason);
  }

  @Get('overview')
  overview() {
    return this.bo.overview();
  }

  // A lista de contas, a ficha e as sessões estão em contas.controller.ts (Backoffice › Contas).

  @Post('users/:id/verify-email')
  @Needs('users.verify_email')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  verify(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) b: z.infer<typeof reasonSchema>) {
    return this.bo.verifyEmail(req.userId!, id, b.reason);
  }

  @Post('users/:id/suspend')
  @Needs('users.suspend')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  suspend(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) b: z.infer<typeof reasonSchema>) {
    return this.bo.suspend(req.userId!, id, b.reason);
  }

  @Post('users/:id/reactivate')
  @Needs('users.suspend')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  reactivate(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) b: z.infer<typeof reasonSchema>) {
    return this.bo.reactivate(req.userId!, id, b.reason);
  }

  /** Dar, mudar ou tirar o selo à mão (tier null tira). Quem decide os pedidos de selo. Fica na auditoria. */
  @Post('users/:id/badge')
  @Needs('users.view', 'verification.decide')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  setBadge(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(badgeSchema)) b: z.infer<typeof badgeSchema>) {
    return this.bo.setBadge(req.userId!, id, b.tier, b.reason);
  }

  @Post('users/:id/notes')
  @Needs('users.notes')
  @HttpCode(204)
  addNote(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(noteSchema)) b: z.infer<typeof noteSchema>) {
    return this.bo.addNote(req.userId!, id, b.body);
  }

  @Get('reports/decided')
  @Needs('reports.read')
  decided(@Query('status') status?: string, @Query('cursor') cursor?: string) {
    return this.bo.decided(status === 'dismissed' ? 'dismissed' : 'actioned', cursor && !Number.isNaN(Date.parse(cursor)) ? cursor : undefined);
  }

  @Get('audit')
  @Needs('audit.read')
  audit(@Query('action') action?: string, @Query('actor') actor?: string, @Query('cursor') cursor?: string) {
    return this.bo.audit_list(action?.slice(0, 60), actor?.slice(0, 60), cursor && /^[0-9a-f-]{36}$/.test(cursor) ? cursor : undefined);
  }
}

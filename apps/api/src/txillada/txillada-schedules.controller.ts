import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { TxilladaSchedulesService } from './txillada-schedules.service';

type AuthedReq = Request & { userId?: string };

const startsAt = z.string().datetime({ offset: true, message: 'Hora inválida.' });
/** Agendar (0176): os mesmos tipos, preço e meta do POST /txilladas (sem o antigo 'followers'). */
const createSchema = z.object({
  title: z.string().trim().max(80).optional().default(''),
  audience: z.enum(['everyone', 'friends', 'close', 'paid']),
  price: z.number().int().min(5, 'A entrada vai de 5 a 5000 vibes.').max(5000, 'A entrada vai de 5 a 5000 vibes.').nullable().optional(),
  goal: z.number().int().min(10, 'A meta vai de 10 a 1000000 vibes.').max(1_000_000, 'A meta vai de 10 a 1000000 vibes.').nullable().optional(),
  goalPurpose: z.string().trim().max(80).optional().default(''),
  startsAt,
});
const updateSchema = z
  .object({ title: z.string().trim().max(80).optional(), startsAt: startsAt.optional() })
  .refine((b) => b.title !== undefined || b.startsAt !== undefined, { message: 'Nada para mudar.' });
const listSchema = z.object({ username: z.string().trim().min(1).max(41).optional() });

/**
 * Txillada agendada (0176) — docs/txillada-agendar.md. Fica registado antes do TxilladaController no módulo: senão o
 * `GET /txilladas/:id` (com ParseUUIDPipe) apanhava `/txilladas/schedules`.
 */
@Controller('txilladas/schedules')
@UseGuards(JwtAuthGuard)
export class TxilladaSchedulesController {
  constructor(private readonly schedules: TxilladaSchedulesService) {}

  @NeedsVerifiedEmail()
  @Post()
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  create(@Req() req: AuthedReq, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.schedules.create(req.userId!, b);
  }

  /** Os 'scheduled' desse anfitrião que eu posso ver (sem `username`, os meus). */
  @Get()
  list(@Req() req: AuthedReq, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.schedules.list(req.userId!, q.username);
  }

  /** «Em breve»: as das próximas 48 h de quem eu sigo. Antes do `:id`. */
  @Get('upcoming')
  upcoming(@Req() req: AuthedReq) {
    return this.schedules.upcoming(req.userId!);
  }

  @Get(':id')
  get(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.schedules.get(req.userId!, id);
  }

  @Patch(':id')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  update(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateSchema)) b: z.infer<typeof updateSchema>) {
    return this.schedules.update(req.userId!, id, b);
  }

  @Delete(':id')
  @HttpCode(204)
  async cancel(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    await this.schedules.cancel(req.userId!, id);
  }

  /** «Lembrar-me» e tirar: no máximo 60 por minuto (no serviço, os dois juntos). */
  @Post(':id/remind')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  remind(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.schedules.remind(req.userId!, id);
  }

  @Delete(':id/remind')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  unremind(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.schedules.unremind(req.userId!, id);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { trackSchema } from '../music/music.service';
import { NotesService } from './notes.service';

type AuthedReq = Request & { userId?: string };

const noteSchema = z
  .object({ body: z.string().trim().max(60).default(''), music: trackSchema.nullable().optional() })
  .refine((n) => n.body.length > 0 || !!n.music, { message: 'Escreve algo ou escolhe uma música', path: ['body'] });
const replySchema = z.object({ text: z.string().trim().min(1).max(500) });

@Controller('notes')
@UseGuards(JwtAuthGuard)
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(@Req() req: AuthedReq) {
    return this.notes.list(req.userId!);
  }

  @NeedsVerifiedEmail()
  @Put('me')
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  set(@Req() req: AuthedReq, @Body(new ZodPipe(noteSchema)) b: z.infer<typeof noteSchema>) {
    return this.notes.set(req.userId!, b.body, b.music ?? null);
  }

  @Delete('me')
  @HttpCode(204)
  remove(@Req() req: AuthedReq) {
    return this.notes.remove(req.userId!);
  }

  @NeedsVerifiedEmail()
  @Post(':username/reply')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  reply(@Req() req: AuthedReq, @Param('username') username: string, @Body(new ZodPipe(replySchema)) b: z.infer<typeof replySchema>) {
    return this.notes.reply(req.userId!, username, b.text);
  }
}

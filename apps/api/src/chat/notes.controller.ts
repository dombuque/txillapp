import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { gifSchema } from '../gifs/gif';
import { musicSchema } from '../music/music.service';
import { NOTE_COLORS, NotesService } from './notes.service';

type AuthedReq = Request & { userId?: string };

/** O local da nota: o nome (como o locationLabel das publicações) e, se houver, a posição (arredondada ao gravar). */
const notePlaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  coarse: z.boolean().optional(),
});

const noteSchema = z
  .object({
    body: z.string().trim().max(60).default(''),
    music: musicSchema.nullable().optional(),
    /** A cor da bolha (lista fechada); null ou ausente = a bolha branca de sempre. */
    color: z.enum(NOTE_COLORS).nullable().optional(),
    place: notePlaceSchema.nullable().optional(),
    /** Um GIF do GIPHY, no mesmo formato das mensagens GIF. */
    gif: gifSchema.nullable().optional(),
    /** Quem vê: 'mutual' (as regras de sempre) ou 'close_friends' (só os meus amigos próximos). */
    audience: z.enum(['mutual', 'close_friends']).default('mutual'),
  })
  .refine((n) => n.body.length > 0 || !!n.music || !!n.gif || !!n.place, { message: 'Escreve algo ou escolhe uma música, um local ou um GIF', path: ['body'] });
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
    return this.notes.set(req.userId!, b.body, b.music ?? null, { color: b.color ?? null, place: b.place ?? null, gif: b.gif ?? null, audience: b.audience });
  }

  @Delete('me')
  @HttpCode(204)
  remove(@Req() req: AuthedReq) {
    return this.notes.remove(req.userId!);
  }

  @Post(':username/cheer')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  cheer(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.notes.cheer(req.userId!, username);
  }

  @NeedsVerifiedEmail()
  @Post(':username/reply')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  reply(@Req() req: AuthedReq, @Param('username') username: string, @Body(new ZodPipe(replySchema)) b: z.infer<typeof replySchema>) {
    return this.notes.reply(req.userId!, username, b.text);
  }
}

import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Injectable, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { Pool } from 'pg';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { PG_POOL } from '../db/db.module';
import { blockedBetween } from '../social/visibility';
import { RealtimeBus } from '../realtime/realtime-bus';
import { ChatEvents } from './chat.events';

type AuthedReq = Request & { userId?: string };

/** Quanto tempo uma pessoa "está a escrever" depois do último sinal. */
const TYPING_MS = 6_000;
const typingKey = (postId: string) => `rt:ptyp:${postId}`;

/**
 * Quem está online e quem está a escrever um comentário, fora do chat (nos posts, nas listas…).
 * Regra única de privacidade, igual à do chat: só se vê se a pessoa mostra a presença E eu também a mostro (quem esconde, não vê).
 */
@Injectable()
export class PresenceService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly events: ChatEvents,
    /** Quem está a escrever em cada post: um conjunto com hora no RealtimeBus (Redis com várias instâncias, senão memória). */
    private readonly bus: RealtimeBus,
  ) {}

  private async iShow(me: string) {
    return (await this.pool.query('SELECT show_presence FROM identity.users WHERE id = $1', [me])).rows[0]?.show_presence !== false;
  }

  /** Dos @utilizador pedidos, os que estão online e que eu posso ver. */
  async online(me: string, usernames: string[]) {
    if (!usernames.length || !(await this.iShow(me))) return [];
    const { rows } = await this.pool.query(
      `SELECT u.id, u.username FROM identity.users u
        WHERE lower(u.username) = ANY($2) AND u.status = 'active' AND u.show_presence AND u.id <> $1 AND NOT ${blockedBetween('u.id', '$1')}`,
      [me, usernames.map((x) => x.toLowerCase())],
    );
    const on = await this.events.onlineAmong(rows.map((r) => r.id as string));
    return rows.filter((r) => on.has(r.id as string)).map((r) => r.username as string);
  }

  /** Sinal de que estou a escrever um comentário neste post (só conta se eu mostro a presença). */
  async ping(me: string, postId: string) {
    if (!/^[0-9a-f-]{36}$/.test(postId)) throw new BadRequestException('Publicação inválida');
    if (!(await this.iShow(me))) return;
    await this.bus.touch(typingKey(postId), me, TYPING_MS);
  }

  /** Nomes de quem está a escrever agora neste post (sem mim, sem quem esconde a presença). */
  async typers(me: string, postId: string) {
    if (!(await this.iShow(me))) return [];
    const ids = (await this.bus.recent(typingKey(postId), TYPING_MS)).filter((id) => id !== me);
    if (!ids.length) return [];
    const { rows } = await this.pool.query(
      `SELECT u.display_name FROM identity.users u WHERE u.id = ANY($2::uuid[]) AND u.status = 'active' AND u.show_presence AND NOT ${blockedBetween('u.id', '$1')}`,
      [me, ids],
    );
    return rows.map((r) => (r.display_name as string).split(' ')[0]);
  }
}

const onlineSchema = z.object({ usernames: z.array(z.string().min(3).max(30)).max(100) });
const pingSchema = z.object({ postId: z.string().uuid() });

@Controller('presence')
@UseGuards(JwtAuthGuard)
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Post('online')
  @HttpCode(200)
  @SkipThrottle()
  async online(@Req() req: AuthedReq, @Body(new ZodPipe(onlineSchema)) b: z.infer<typeof onlineSchema>) {
    return { online: await this.presence.online(req.userId!, b.usernames) };
  }

  @Post('typing')
  @HttpCode(204)
  @SkipThrottle()
  ping(@Req() req: AuthedReq, @Body(new ZodPipe(pingSchema)) b: z.infer<typeof pingSchema>) {
    return this.presence.ping(req.userId!, b.postId);
  }

  @Get('typing')
  @SkipThrottle()
  async typers(@Req() req: AuthedReq, @Query('postId') postId: string) {
    if (!/^[0-9a-f-]{36}$/.test(postId ?? '')) throw new BadRequestException('Publicação inválida');
    return { names: await this.presence.typers(req.userId!, postId) };
  }
}

import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { gifSchema } from '../gifs/gif';
import { CommentsService } from './comments.service';

type AuthedReq = Request & { userId?: string };

const createSchema = z
  .object({
    body: z.string().trim().max(1000).default(''),
    parentId: z.string().uuid().optional(),
    // Um GIF do GIPHY (opcional, com ou sem texto): o url tem de ser https de media*.giphy.com (src/gifs/gif.ts).
    gif: gifSchema.optional(),
  })
  .refine((b) => b.body.length > 0 || !!b.gif, { message: 'Escreve alguma coisa', path: ['body'] });
const editSchema = z.object({ body: z.string().trim().min(1).max(1000) });
const limitOf = (v?: string, def = 15) => Math.min(Math.max(parseInt(v ?? String(def), 10) || def, 1), 50);

@Controller()
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('posts/:postId/comments')
  list(@Req() req: AuthedReq, @Param('postId', ParseUUIDPipe) postId: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.comments.list(req.userId!, postId, cursor, limitOf(limit));
  }

  @NeedsVerifiedEmail()
  @Post('posts/:postId/comments')
  create(@Req() req: AuthedReq, @Param('postId', ParseUUIDPipe) postId: string, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.comments.create(req.userId!, postId, b.body, b.parentId, b.gif);
  }

  @Get('comments/:id/replies')
  replies(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.comments.replies(req.userId!, id, cursor, limitOf(limit, 10));
  }

  @Post('comments/:id/cheers')
  @HttpCode(200)
  cheer(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.comments.toggleCheer(req.userId!, id);
  }

  @Patch('comments/:id')
  update(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(editSchema)) b: z.infer<typeof editSchema>) {
    return this.comments.update(req.userId!, id, b.body);
  }

  @Delete('comments/:id')
  remove(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.comments.remove(req.userId!, id);
  }
}

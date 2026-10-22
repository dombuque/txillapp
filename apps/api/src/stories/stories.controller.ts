import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { StoriesService } from './stories.service';

type AuthedReq = Request & { userId?: string };
const createSchema = z.object({ mediaId: z.string().uuid(), caption: z.string().trim().max(200).default('') });

const replySchema = z.object({ body: z.string().trim().min(1).max(500) });

@Controller('stories')
@UseGuards(JwtAuthGuard)
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Post()
  create(@Req() req: AuthedReq, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.stories.create(req.userId!, b.mediaId, b.caption);
  }

  @Get()
  tray(@Req() req: AuthedReq) {
    return this.stories.tray(req.userId!);
  }

  @Get('user/:username')
  byUser(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.stories.byUser(req.userId!, username);
  }

  @Post(':id/view')
  @HttpCode(204)
  view(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.stories.view(req.userId!, id);
  }

  @Post(':id/replies')
  @HttpCode(201)
  reply(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(replySchema)) b: z.infer<typeof replySchema>) {
    return this.stories.reply(req.userId!, id, b.body);
  }

  @Get(':id/replies')
  replies(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.stories.replies(req.userId!, id);
  }

  @Get(':id/viewers')
  viewers(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.stories.viewers(req.userId!, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.stories.remove(req.userId!, id);
  }
}

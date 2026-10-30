import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { StoriesService } from './stories.service';

type AuthedReq = Request & { userId?: string };
const createSchema = z.object({ mediaId: z.string().uuid(), caption: z.string().trim().max(200).default(''), audience: z.enum(['all', 'close_friends']).default('all') });

const shareSchema = z.object({ postId: z.string().uuid(), caption: z.string().trim().max(200).default(''), audience: z.enum(['all', 'close_friends']).default('all') });
const replySchema = z.object({ body: z.string().trim().min(1).max(500) });
const settingsSchema = z.object({ replies: z.enum(['everyone', 'following', 'off']) });

@Controller('stories')
@UseGuards(JwtAuthGuard)
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @NeedsVerifiedEmail()
  @Post()
  create(@Req() req: AuthedReq, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.stories.create(req.userId!, b.mediaId, b.caption, b.audience);
  }

  /** Partilhar uma publicação (foto ou reel) no meu status. */
  @NeedsVerifiedEmail()
  @Post('share')
  @HttpCode(201)
  share(@Req() req: AuthedReq, @Body(new ZodPipe(shareSchema)) b: z.infer<typeof shareSchema>) {
    return this.stories.share(req.userId!, b.postId, b.caption, b.audience);
  }

  @Get('close-friends')
  closeFriends(@Req() req: AuthedReq) {
    return this.stories.closeFriends(req.userId!);
  }

  @Put('close-friends/:username')
  @HttpCode(204)
  addCloseFriend(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.stories.addCloseFriend(req.userId!, username);
  }

  @Delete('close-friends/:username')
  @HttpCode(204)
  removeCloseFriend(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.stories.removeCloseFriend(req.userId!, username);
  }

  @Get()
  tray(@Req() req: AuthedReq) {
    return this.stories.tray(req.userId!);
  }

  /** Definições dos meus stories: quem pode responder e a quem estão escondidos. */
  @Get('settings')
  settings(@Req() req: AuthedReq) {
    return this.stories.settings(req.userId!);
  }

  @Patch('settings')
  setSettings(@Req() req: AuthedReq, @Body(new ZodPipe(settingsSchema)) b: z.infer<typeof settingsSchema>) {
    return this.stories.setReplies(req.userId!, b.replies);
  }

  @Put('hidden/:username')
  hide(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.stories.hide(req.userId!, username);
  }

  @Delete('hidden/:username')
  unhide(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.stories.unhide(req.userId!, username);
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

  @NeedsVerifiedEmail()
  @Post(':id/replies')
  @HttpCode(201)
  reply(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(replySchema)) b: z.infer<typeof replySchema>) {
    return this.stories.reply(req.userId!, id, b.body);
  }

  @Get(':id/comments')
  comments(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.stories.comments(req.userId!, id);
  }

  @NeedsVerifiedEmail()
  @Post(':id/comments')
  @HttpCode(201)
  comment(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(replySchema)) b: z.infer<typeof replySchema>) {
    return this.stories.comment(req.userId!, id, b.body);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  deleteComment(@Req() req: AuthedReq, @Param('commentId', ParseUUIDPipe) commentId: string) {
    return this.stories.deleteComment(req.userId!, commentId);
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

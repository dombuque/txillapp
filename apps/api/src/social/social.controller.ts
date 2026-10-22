import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { PostsService } from '../posts/posts.service';
import { SocialService } from './social.service';

type AuthedReq = Request & { userId?: string };

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  bio: z.string().trim().max(150).optional(),
  isPrivate: z.boolean().optional(),
});

const avatarSchema = z.object({ mediaId: z.string().uuid() });
const who = z.enum(['everyone', 'following', 'off']);
const privacySchema = z.object({
  isPrivate: z.boolean().optional(),
  commentsAllowed: who.optional(),
  giftsAllowed: who.optional(),
  showConnections: z.enum(['everyone', 'followers', 'me']).optional(),
  suggestable: z.boolean().optional(),
});

@Controller()
@UseGuards(JwtAuthGuard)
export class SocialController {
  constructor(
    private readonly social: SocialService,
    private readonly posts: PostsService,
  ) {}

  @Patch('users/me')
  updateMe(@Req() req: AuthedReq, @Body(new ZodPipe(updateSchema)) b: z.infer<typeof updateSchema>) {
    return this.social.updateMe(req.userId!, b);
  }

  @Put('users/me/avatar')
  setAvatar(@Req() req: AuthedReq, @Body(new ZodPipe(avatarSchema)) b: z.infer<typeof avatarSchema>) {
    return this.social.setAvatar(req.userId!, b.mediaId);
  }

  @Delete('users/me/avatar')
  clearAvatar(@Req() req: AuthedReq) {
    return this.social.clearAvatar(req.userId!);
  }

  /** Definições de privacidade (quem pode comentar, presentear, ver listas, ser sugerido…). */
  @Get('settings/privacy')
  privacy(@Req() req: AuthedReq) {
    return this.social.privacy(req.userId!);
  }

  @Patch('settings/privacy')
  setPrivacy(@Req() req: AuthedReq, @Body(new ZodPipe(privacySchema)) b: z.infer<typeof privacySchema>) {
    return this.social.setPrivacy(req.userId!, b);
  }

  @Get('blocks')
  blocked(@Req() req: AuthedReq) {
    return this.social.blocked(req.userId!);
  }

  @Put('blocks/:username')
  block(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.social.block(req.userId!, username);
  }

  @Delete('blocks/:username')
  unblock(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.social.unblock(req.userId!, username);
  }

  @Get('users/:username')
  profile(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.social.profile(req.userId!, username);
  }

  @Get('users/:username/posts')
  async userPosts(@Req() req: AuthedReq, @Param('username') username: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    await this.social.assertVisible(req.userId!, username);
    const n = Math.min(Math.max(parseInt(limit ?? '18', 10) || 18, 1), 50);
    return this.posts.byAuthor(req.userId!, username, cursor, n);
  }

  @Post('users/:username/follow')
  @HttpCode(200)
  follow(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.social.follow(req.userId!, username);
  }

  @Delete('users/:username/follow')
  unfollow(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.social.unfollow(req.userId!, username);
  }

  @Get('users/:username/followers')
  followers(@Req() req: AuthedReq, @Param('username') username: string, @Query('cursor') cursor?: string) {
    return this.social.followers(req.userId!, username, cursor);
  }

  @Get('users/:username/following')
  following(@Req() req: AuthedReq, @Param('username') username: string, @Query('cursor') cursor?: string) {
    return this.social.following(req.userId!, username, cursor);
  }

  @Get('follow-requests')
  requests(@Req() req: AuthedReq) {
    return this.social.requests(req.userId!);
  }

  @Post('follow-requests/:username/accept')
  @HttpCode(204)
  accept(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.social.acceptRequest(req.userId!, username);
  }

  @Post('follow-requests/:username/decline')
  @HttpCode(204)
  decline(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.social.declineRequest(req.userId!, username);
  }

  @Get('suggestions/people')
  suggestions(@Req() req: AuthedReq) {
    return this.social.suggestions(req.userId!);
  }

  @Post('suggestions/people/:username/dismiss')
  @HttpCode(204)
  dismiss(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.social.dismiss(req.userId!, username);
  }
}

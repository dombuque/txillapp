import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PostsModule } from '../posts/posts.module';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

@Module({
  imports: [AuthModule, PostsModule],
  controllers: [SocialController],
  providers: [SocialService],
})
export class SocialModule {}

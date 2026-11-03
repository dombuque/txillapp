import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { MusicModule } from '../music/music.module';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';

@Module({
  imports: [AuthModule, ChatModule, MusicModule],
  controllers: [StoriesController],
  providers: [StoriesService],
})
export class StoriesModule {}

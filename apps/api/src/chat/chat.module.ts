import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { PostsModule } from '../posts/posts.module';
import { ChatController } from './chat.controller';
import { ChatEvents } from './chat.events';
import { ChatService } from './chat.service';
import { GroupsService } from './groups.service';

@Module({
  imports: [AuthModule, MediaModule, PostsModule],
  controllers: [ChatController],
  providers: [ChatService, GroupsService, ChatEvents],
  exports: [ChatService],
})
export class ChatModule {}

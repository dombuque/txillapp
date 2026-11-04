import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { MusicModule } from '../music/music.module';
import { PostsModule } from '../posts/posts.module';
import { ChatController } from './chat.controller';
import { ChatEvents } from './chat.events';
import { ChatService } from './chat.service';
import { GroupsService } from './groups.service';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { PresenceController, PresenceService } from './presence.controller';

@Module({
  imports: [AuthModule, MediaModule, MusicModule, PostsModule],
  controllers: [ChatController, NotesController, PresenceController],
  providers: [ChatService, GroupsService, NotesService, ChatEvents, PresenceService],
  exports: [ChatService],
})
export class ChatModule {}

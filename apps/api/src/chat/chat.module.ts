import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { ChatController } from './chat.controller';
import { ChatEvents } from './chat.events';
import { ChatService } from './chat.service';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [ChatController],
  providers: [ChatService, ChatEvents],
  exports: [ChatService],
})
export class ChatModule {}

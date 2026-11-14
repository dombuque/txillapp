import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { PostsModule } from '../posts/posts.module';
import { MixarController } from './mixar.controller';
import { MixarService } from './mixar.service';

/** Mixar (0150, docs/mixar-contrato.md): o feed a dois, o convite no chat, as reações, o desafio do dia e a tarefa `mixar.daily`. */
@Module({
  imports: [AuthModule, ChatModule, PostsModule],
  controllers: [MixarController],
  providers: [MixarService],
  exports: [MixarService],
})
export class MixarModule {}

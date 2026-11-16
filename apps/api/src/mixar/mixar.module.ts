import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { MediaModule } from '../media/media.module';
import { PostsModule } from '../posts/posts.module';
import { MixarControloController, MixarPrivateTopicsController } from './mixar-controlo.controller';
import { MixarControloService } from './mixar-controlo.service';
import { MixarController } from './mixar.controller';
import { MixarService } from './mixar.service';

/**
 * Mixar (0150, docs/mixar-contrato.md): o feed a dois, o convite no chat, as reações, o desafio do dia e a tarefa `mixar.daily`.
 * MixarControlo* (0172): afinar os temas, os temas privados e o resumo da semana (MediaModule: o cartão para o Zás e os mimos).
 */
@Module({
  imports: [AuthModule, ChatModule, PostsModule, MediaModule],
  controllers: [MixarController, MixarControloController, MixarPrivateTopicsController],
  providers: [MixarService, MixarControloService],
  exports: [MixarService],
})
export class MixarModule {}

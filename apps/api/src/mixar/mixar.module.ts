import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { PostsModule } from '../posts/posts.module';
import { MixarAvisosController } from './mixar-avisos.controller';
import { MixarAvisosService } from './mixar-avisos.service';
import { MixarSocialController } from './mixar-social.controller';
import { MixarSocialService } from './mixar-social.service';
import { MixarController } from './mixar.controller';
import { MixarService } from './mixar.service';

/**
 * Mixar (0150, docs/mixar-contrato.md): o feed a dois, o convite no chat, as reações, o desafio do dia e a tarefa `mixar.daily`.
 * Os avisos e a descoberta (0170) ficam no MixarAvisosController/Service; o controller vem primeiro para `GET /mixar/suggestions`
 * não ser apanhado pelo `GET /mixar/:id`.
 */
@Module({
  imports: [AuthModule, ChatModule, PostsModule],
  controllers: [MixarAvisosController, MixarController, MixarSocialController],
  // O social e os guardados (0171, mixar-social.*): a conversa de cada item, ver juntos, «Mais 5» e os Guardados.
  providers: [MixarService, MixarAvisosService, MixarSocialService],
  exports: [MixarService, MixarAvisosService, MixarSocialService],
})
export class MixarModule {}

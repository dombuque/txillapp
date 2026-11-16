import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { MediaModule } from '../media/media.module';
import { PostsModule } from '../posts/posts.module';
import { MixarAvisosController } from './mixar-avisos.controller';
import { MixarAvisosService } from './mixar-avisos.service';
import { MixarSocialController } from './mixar-social.controller';
import { MixarSocialService } from './mixar-social.service';
import { MixarControloController, MixarPrivateTopicsController } from './mixar-controlo.controller';
import { MixarControloService } from './mixar-controlo.service';
import { MixarController } from './mixar.controller';
import { MixarService } from './mixar.service';

/**
 * Mixar (0150, docs/mixar-contrato.md): o feed a dois, o convite no chat, as reações, o desafio do dia e a tarefa `mixar.daily`.
 * Os avisos e a descoberta (0170) ficam no MixarAvisosController/Service; o controller vem primeiro para `GET /mixar/suggestions`
 * não ser apanhado pelo `GET /mixar/:id`. O mesmo vale para `/me/mixar/private-topics` (fora do prefixo `mixar`, mas fica antes).
 * MixarControlo* (0172): afinar os temas, os temas privados e o resumo da semana (MediaModule: o cartão para o Zás e os mimos).
 */
@Module({
  imports: [AuthModule, ChatModule, PostsModule, MediaModule],
  controllers: [MixarAvisosController, MixarPrivateTopicsController, MixarController, MixarSocialController, MixarControloController],
  // O social e os guardados (0171, mixar-social.*): a conversa de cada item, ver juntos, «Mais 5» e os Guardados.
  providers: [MixarService, MixarAvisosService, MixarSocialService, MixarControloService],
  exports: [MixarService, MixarAvisosService, MixarSocialService],
})
export class MixarModule {}

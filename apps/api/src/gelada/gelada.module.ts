import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { PostsModule } from '../posts/posts.module';
import { GeladaFridayService } from './gelada-friday.service';
import { GeladaController } from './gelada.controller';
import { GeladaService } from './gelada.service';

/** «Paga-me uma» (0145): pedidos, o livro das geladas, rodadas nos TxillGroups e a sexta da gelada. Sem dinheiro. */
@Module({
  imports: [AuthModule, ChatModule, PostsModule],
  controllers: [GeladaController],
  providers: [GeladaService, GeladaFridayService],
  exports: [GeladaFridayService],
})
export class GeladaModule {}

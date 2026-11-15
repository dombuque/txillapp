import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { MediaModule } from '../media/media.module';
import { InstantsController } from './instants.controller';
import { InstantsService } from './instants.service';
import { InstantsDownloadController } from './instants-download.controller';
import { InstantsDownloadService } from './instants-download.service';
import { InstantsRecapController } from './instants-recap.controller';
import { InstantsRecapService } from './instants-recap.service';

@Module({
  // ChatModule: o canal em tempo real (ChatEvents), para o Zás novo chegar logo a quem o pode ver.
  // InstantsDownload*: guardar o meu Zás com a assinatura (GET /instants/:id/download).
  // InstantsRecap*: o resumo semanal dos Zás, a definição, o arquivo dos meus Zás e a limpeza (0163).
  imports: [AuthModule, MediaModule, ChatModule],
  controllers: [InstantsRecapController, InstantsController, InstantsDownloadController],
  providers: [InstantsService, InstantsDownloadService, InstantsRecapService],
  exports: [InstantsRecapService],
})
export class InstantsModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { MediaModule } from '../media/media.module';
import { InstantsController } from './instants.controller';
import { InstantsService } from './instants.service';

@Module({
  // ChatModule: o canal em tempo real (ChatEvents), para o Zás novo chegar logo a quem o pode ver.
  imports: [AuthModule, MediaModule, ChatModule],
  controllers: [InstantsController],
  providers: [InstantsService],
})
export class InstantsModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { MusicModule } from '../music/music.module';
import { SoundAudioController, SoundsAdminController } from './sounds.controller';
import { SoundsService } from './sounds.service';

/**
 * Os sons das tchekas (0133, docs/sons.md). O PostsModule importa este módulo (publicar com som, tirar o som original) e
 * declara o SoundsController (a página do som usa o formato das publicações).
 */
@Module({
  imports: [AuthModule, MediaModule, MusicModule],
  controllers: [SoundAudioController, SoundsAdminController],
  providers: [SoundsService],
  exports: [SoundsService],
})
export class SoundsModule {}

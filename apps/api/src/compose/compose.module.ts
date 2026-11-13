import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { MusicModule } from '../music/music.module';
import { ComposeAnalyzeService } from './analyze.service';
import { ComposeController } from './compose.controller';
import { ComposeService } from './compose.service';

/** Montagem das tchekas no servidor com o ffmpeg (para a app nativa). Ver docs/montagem.md. */
@Module({
  imports: [AuthModule, MediaModule, MusicModule],
  controllers: [ComposeController],
  providers: [ComposeService, ComposeAnalyzeService],
  exports: [ComposeService],
})
export class ComposeModule {}

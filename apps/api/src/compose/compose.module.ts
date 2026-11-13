import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { MusicModule } from '../music/music.module';
import { ComposeController } from './compose.controller';
import { ComposeService } from './compose.service';
import { VoicePreviewService } from './voice-preview.service';

/** Montagem das tchekas no servidor com o ffmpeg (para a app nativa). Ver docs/montagem.md. */
@Module({
  imports: [AuthModule, MediaModule, MusicModule],
  controllers: [ComposeController],
  providers: [ComposeService, VoicePreviewService],
  exports: [ComposeService],
})
export class ComposeModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AvatarsController, MediaController } from './media.controller';
import { HELD_PUBLICATIONS, HeldPublicationsService } from './held-publications.service';
import { MediaService } from './media.service';
import { UnusedMediaService } from './unused-media.service';
import { VideoService } from './video.service';

@Module({
  imports: [AuthModule],
  controllers: [MediaController, AvatarsController],
  providers: [MediaService, VideoService, UnusedMediaService, HeldPublicationsService, { provide: HELD_PUBLICATIONS, useExisting: HeldPublicationsService }],
  exports: [MediaService, UnusedMediaService, HeldPublicationsService, HELD_PUBLICATIONS],
})
export class MediaModule {}

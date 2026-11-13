import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AvatarsController, MediaController } from './media.controller';
import { MediaService } from './media.service';
import { UnusedMediaService } from './unused-media.service';
import { VideoService } from './video.service';

@Module({
  imports: [AuthModule],
  controllers: [MediaController, AvatarsController],
  providers: [MediaService, VideoService, UnusedMediaService],
  exports: [MediaService, UnusedMediaService],
})
export class MediaModule {}

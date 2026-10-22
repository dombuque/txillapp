import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AvatarsController, MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  imports: [AuthModule],
  controllers: [MediaController, AvatarsController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}

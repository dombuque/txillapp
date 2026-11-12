import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { LicensedMusicAdminController, LicensedMusicController } from './licensed-music.controller';
import { LicensedMusicService } from './licensed-music.service';
import { MusicController } from './music.controller';
import { MusicService } from './music.service';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [MusicController, LicensedMusicController, LicensedMusicAdminController],
  providers: [MusicService, LicensedMusicService],
  exports: [MusicService, LicensedMusicService],
})
export class MusicModule {}

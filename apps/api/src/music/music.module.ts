import { Module } from '@nestjs/common';
import { ArtistsModule } from '../artists/artists.module';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { MusicController } from './music.controller';
import { MusicService } from './music.service';

@Module({
  imports: [AuthModule, MediaModule, ArtistsModule],
  controllers: [MusicController],
  providers: [MusicService],
  exports: [MusicService],
})
export class MusicModule {}

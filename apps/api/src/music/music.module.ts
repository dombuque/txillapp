import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MusicController } from './music.controller';
import { MusicService } from './music.service';

@Module({
  imports: [AuthModule],
  controllers: [MusicController],
  providers: [MusicService],
  exports: [MusicService],
})
export class MusicModule {}

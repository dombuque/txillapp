import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { ArtistsController, ArtistsDeskController } from './artists.controller';
import { ArtistsService } from './artists.service';

/** Programa de artistas moçambicanos (0131): pedido, faixas com licença, moderação, seletor e denúncias de direitos. */
@Module({
  imports: [AuthModule, MediaModule],
  controllers: [ArtistsController, ArtistsDeskController],
  providers: [ArtistsService],
  exports: [ArtistsService],
})
export class ArtistsModule {}

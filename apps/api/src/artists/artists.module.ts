import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { MusicModule } from '../music/music.module';
import { ArtistsController, ArtistsDeskController } from './artists.controller';
import { ArtistsService } from './artists.service';

/** Programa de artistas moçambicanos (0131): pedido, faixas com licença, moderação, seletor e denúncias de direitos. */
@Module({
  // MusicModule: o ArtistsService regista-se no MusicCatalogService como a fonte `local` do seletor (docs/musica.md).
  imports: [AuthModule, MediaModule, MusicModule],
  controllers: [ArtistsController, ArtistsDeskController],
  providers: [ArtistsService],
  exports: [ArtistsService],
})
export class ArtistsModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { MusicCatalogAdminController } from './catalog/catalog-admin.controller';
import { MusicCatalogService } from './catalog/catalog.service';
import { LicensedMusicAdminController, LicensedMusicController } from './licensed-music.controller';
import { LicensedMusicService } from './licensed-music.service';
import { MusicController } from './music.controller';
import { MusicService } from './music.service';

/** Música: o catálogo curado (e a fonte `local` regista-se no MusicCatalogService), a música licenciada (desligada por omissão), as favoritas e os clipes. Ver docs/musica.md e docs/musica-licenciada.md. */
@Module({
  imports: [AuthModule, MediaModule],
  controllers: [MusicController, MusicCatalogAdminController, LicensedMusicController, LicensedMusicAdminController],
  providers: [MusicService, MusicCatalogService, LicensedMusicService],
  exports: [MusicService, MusicCatalogService, LicensedMusicService],
})
export class MusicModule {}

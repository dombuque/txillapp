import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { MusicCatalogAdminController } from './catalog/catalog-admin.controller';
import { MusicCatalogService } from './catalog/catalog.service';
import { MusicController } from './music.controller';
import { MusicService } from './music.service';

/** Música: o catálogo curado (e a fonte `local` regista-se no MusicCatalogService), as favoritas e os clipes. Ver docs/musica.md. */
@Module({
  imports: [AuthModule, MediaModule],
  controllers: [MusicController, MusicCatalogAdminController],
  providers: [MusicService, MusicCatalogService],
  exports: [MusicService, MusicCatalogService],
})
export class MusicModule {}

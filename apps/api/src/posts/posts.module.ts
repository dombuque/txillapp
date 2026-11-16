import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoostsModule } from '../boosts/boosts.module';
import { MediaModule } from '../media/media.module';
import { MusicModule } from '../music/music.module';
import { NearbyModule } from '../nearby/nearby.module';
import { SoundsController } from '../sounds/sounds.controller';
import { SoundsModule } from '../sounds/sounds.module';
import { WalletModule } from '../wallet/wallet.module';
import { GiftsController } from './gifts.controller';
import { MusicBakeService } from './music-bake.service';
import { PostDownloadController } from './post-download.controller';
import { PostDownloadService } from './post-download.service';
import { FeedController, MyPostsController, PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { PublicPostController, ShareController } from './share.controller';

@Module({
  // Bombar (destaques no feed) e os eventos dos locais (o cartão do destaque de um evento). Os sons das tchekas (docs/sons.md):
  // a página do som (SoundsController) usa o formato das publicações, por isso o controlador vive aqui.
  // O fim de tcheka: a música gravada no vídeo (MusicBakeService, posts/music-bake.ts) e a cópia guardada com o cartão do
  // fim (GET /posts/:id/download, PostDownloadService).
  imports: [AuthModule, WalletModule, MusicModule, BoostsModule, NearbyModule, SoundsModule, MediaModule],
  controllers: [FeedController, PostsController, MyPostsController, GiftsController, ShareController, PublicPostController, SoundsController, PostDownloadController],
  providers: [PostsService, MusicBakeService, PostDownloadService],
  exports: [PostsService, PostDownloadService],
})
export class PostsModule {}

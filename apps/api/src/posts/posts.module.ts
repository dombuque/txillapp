import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoostsModule } from '../boosts/boosts.module';
import { MusicModule } from '../music/music.module';
import { NearbyModule } from '../nearby/nearby.module';
import { WalletModule } from '../wallet/wallet.module';
import { GiftsController } from './gifts.controller';
import { FeedController, PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { PublicPostController, ShareController } from './share.controller';

@Module({
  // Bombar (destaques no feed) e os eventos dos locais (o cartão do destaque de um evento).
  imports: [AuthModule, WalletModule, MusicModule, BoostsModule, NearbyModule],
  controllers: [FeedController, PostsController, GiftsController, ShareController, PublicPostController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}

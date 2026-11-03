import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MusicModule } from '../music/music.module';
import { WalletModule } from '../wallet/wallet.module';
import { GiftsController } from './gifts.controller';
import { FeedController, PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { PublicPostController, ShareController } from './share.controller';

@Module({
  imports: [AuthModule, WalletModule, MusicModule],
  controllers: [FeedController, PostsController, GiftsController, ShareController, PublicPostController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}

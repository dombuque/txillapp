import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { GiftsController } from './gifts.controller';
import { FeedController, PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { ShareController } from './share.controller';

@Module({
  imports: [AuthModule, WalletModule],
  controllers: [FeedController, PostsController, GiftsController, ShareController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { GiftsController } from './gifts.controller';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  imports: [AuthModule, WalletModule],
  controllers: [PostsController, GiftsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GifsModule } from '../gifs/gifs.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  imports: [AuthModule, GifsModule],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}

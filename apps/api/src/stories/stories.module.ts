import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';

@Module({
  imports: [AuthModule],
  controllers: [StoriesController],
  providers: [StoriesService],
})
export class StoriesModule {}

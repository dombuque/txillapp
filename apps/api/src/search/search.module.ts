import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PostsModule } from '../posts/posts.module';
import { VenuesModule } from '../venues/venues.module';
import { SearchController, TagsController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [AuthModule, PostsModule, VenuesModule],
  controllers: [SearchController, TagsController],
  providers: [SearchService],
})
export class SearchModule {}

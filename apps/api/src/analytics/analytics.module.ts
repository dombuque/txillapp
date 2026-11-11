import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ModerationModule } from '../moderation/moderation.module';
import { AnalysesController } from './analyses.controller';
import { AnalysesService } from './analyses.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { SearchStatsService } from './search-stats.service';

@Module({
  imports: [AuthModule, ModerationModule],
  controllers: [AnalyticsController, AnalysesController],
  providers: [AnalyticsService, AnalysesService, SearchStatsService],
  exports: [SearchStatsService],
})
export class AnalyticsModule {}

import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminGuard, ModerationController } from './moderation.controller';
import { ImageModerationService } from './image-moderation.service';
import { ModerationService } from './moderation.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [ModerationController],
  providers: [ModerationService, ImageModerationService, AdminGuard],
  exports: [ModerationService, ImageModerationService],
})
export class ModerationModule {}

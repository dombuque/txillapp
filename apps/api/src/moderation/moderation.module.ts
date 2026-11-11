import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ModerationController } from './moderation.controller';
import { ModerationDeskController } from './moderation-desk.controller';
import { ModerationDeskService } from './moderation-desk.service';
import { ImageModerationService } from './image-moderation.service';
import { ModerationService } from './moderation.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [ModerationController, ModerationDeskController],
  providers: [ModerationService, ImageModerationService, ModerationDeskService],
  exports: [ModerationService, ImageModerationService],
})
export class ModerationModule {}

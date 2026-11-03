import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { InstantsController } from './instants.controller';
import { InstantsService } from './instants.service';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [InstantsController],
  providers: [InstantsService],
})
export class InstantsModule {}

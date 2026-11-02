import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [VerificationController],
  providers: [VerificationService],
})
export class VerificationModule {}

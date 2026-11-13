import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { AccountController } from './account.controller';
import { ExportService } from './export.service';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [AccountController],
  providers: [ExportService],
})
export class AccountModule {}

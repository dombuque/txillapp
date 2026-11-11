import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditDeskController } from './audit-desk.controller';
import { AuditDeskService } from './audit-desk.service';
import { BackofficeController } from './backoffice.controller';
import { BackofficeService } from './backoffice.service';

@Module({
  imports: [AuthModule],
  controllers: [BackofficeController, AuditDeskController],
  providers: [BackofficeService, AuditDeskService],
})
export class BackofficeModule {}

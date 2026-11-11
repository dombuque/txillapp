import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditDeskController } from './audit-desk.controller';
import { AuditDeskService } from './audit-desk.service';
import { BackofficeController } from './backoffice.controller';
import { BackofficeService } from './backoffice.service';
import { ContasController } from './contas.controller';
import { ContasService } from './contas.service';

@Module({
  imports: [AuthModule],
  controllers: [BackofficeController, ContasController, AuditDeskController],
  providers: [BackofficeService, ContasService, AuditDeskService],
})
export class BackofficeModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BackofficeController } from './backoffice.controller';
import { BackofficeService } from './backoffice.service';
import { ContasController } from './contas.controller';
import { ContasService } from './contas.service';

@Module({
  imports: [AuthModule],
  controllers: [BackofficeController, ContasController],
  providers: [BackofficeService, ContasService],
})
export class BackofficeModule {}

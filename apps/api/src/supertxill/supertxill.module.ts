import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperTxillController } from './supertxill.controller';
import { SuperTxillService } from './supertxill.service';

@Module({
  imports: [AuthModule],
  controllers: [SuperTxillController],
  providers: [SuperTxillService],
})
export class SuperTxillModule {}

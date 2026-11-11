import { Module } from '@nestjs/common';
import { BoostsModule } from '../boosts/boosts.module';
import { FinController } from './fin.controller';
import { FinService } from './fin.service';

/** Backoffice: Finanças e Crescimento (só leitura). */
@Module({
  imports: [BoostsModule],
  controllers: [FinController],
  providers: [FinService],
})
export class FinModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoostsModule } from '../boosts/boosts.module';
import { IapAdminController, IapController } from './iap.controller';
import { IapService } from './iap.service';

/** Compras pela loja (App Store e Google Play): a verificação paga e o Bombar. Os Txills não se vendem nas lojas. */
@Module({
  imports: [AuthModule, BoostsModule],
  controllers: [IapController, IapAdminController],
  providers: [IapService],
  exports: [IapService],
})
export class IapModule {}

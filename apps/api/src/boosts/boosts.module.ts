import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { BoostsAdminController, BoostsController } from './boosts.controller';
import { BoostsService } from './boosts.service';

/** Bombar: destaques pagos dos locais (no feed e no mapa), pagos com os Txills da carteira do local. */
@Module({
  imports: [AuthModule, WalletModule],
  controllers: [BoostsController, BoostsAdminController],
  providers: [BoostsService],
  exports: [BoostsService],
})
export class BoostsModule {}

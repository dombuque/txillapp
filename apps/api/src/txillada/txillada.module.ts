import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { TxilladaAdminController, TxilladaController, TxilladaWebhookController } from './txillada.controller';
import { TxilladaService } from './txillada.service';
import { TXILLADA_HOOKS } from './txillada-tokens';

/**
 * Txillada (os lives), fase 1. O cliente do LiveKit (LIVEKIT_ROOMS) vem do AppModule (os testes trocam-no). A moderação
 * corta uma Txillada denunciada através de TXILLADA_HOOKS (sem import circular).
 */
@Module({
  imports: [AuthModule, WalletModule],
  controllers: [TxilladaController, TxilladaWebhookController, TxilladaAdminController],
  providers: [TxilladaService, { provide: TXILLADA_HOOKS, useExisting: TxilladaService }],
  exports: [TxilladaService, TXILLADA_HOOKS],
})
export class TxilladaModule {}

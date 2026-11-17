import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { TxilladaSchedulesController } from './txillada-schedules.controller';
import { TxilladaSchedulesService } from './txillada-schedules.service';
import { TxilladaAdminController, TxilladaController, TxilladaWebhookController } from './txillada.controller';
import { TxilladaService } from './txillada.service';
import { TXILLADA_HOOKS } from './txillada-tokens';

/**
 * Txillada (os lives), fase 1. O cliente do LiveKit (LIVEKIT_ROOMS) vem do AppModule (os testes trocam-no). A moderação
 * corta uma Txillada denunciada através de TXILLADA_HOOKS (sem import circular). A Txillada agendada (0176) tem o seu
 * controlador primeiro (as rotas /txilladas/schedules antes de /txilladas/:id).
 */
@Module({
  imports: [AuthModule, WalletModule],
  controllers: [TxilladaSchedulesController, TxilladaController, TxilladaWebhookController, TxilladaAdminController],
  providers: [TxilladaSchedulesService, TxilladaService, { provide: TXILLADA_HOOKS, useExisting: TxilladaService }],
  exports: [TxilladaService, TxilladaSchedulesService, TXILLADA_HOOKS],
})
export class TxilladaModule {}

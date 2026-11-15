import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GeleiraModule } from '../geleira/geleira.module';
import { NearbyModule } from '../nearby/nearby.module';
import { TxilladaModule } from '../txillada/txillada.module';
import { VenuesModule } from '../venues/venues.module';
import { SuperTxillController } from './supertxill.controller';
import { SuperTxillService } from './supertxill.service';
import { SuperTxillTools } from './supertxill.tools';

@Module({
  imports: [AuthModule, NearbyModule, VenuesModule, TxilladaModule, GeleiraModule],
  controllers: [SuperTxillController],
  providers: [SuperTxillService, SuperTxillTools],
})
export class SuperTxillModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoostsModule } from '../boosts/boosts.module';
import { EventsService } from './events.service';
import { EventsController, NearbyController, VenueEventsController } from './nearby.controller';
import { NearbyService } from './nearby.service';
import { SchemaProbe } from './schema-probe';

/** "À tua volta": mapa do que acontece perto (locais, eventos, publicações, TxillGroups públicos e a malta). */
@Module({
  imports: [AuthModule, BoostsModule],
  controllers: [NearbyController, EventsController, VenueEventsController],
  providers: [NearbyService, EventsService, SchemaProbe],
  exports: [EventsService],
})
export class NearbyModule {}

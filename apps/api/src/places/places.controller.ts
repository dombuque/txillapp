import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { PlacesService } from './places.service';

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

@Controller('places')
@UseGuards(JwtAuthGuard)
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  /** Sugestões "Perto de ti". Não guarda coordenadas; só devolve nomes de sítios. */
  @Get('nearby')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  nearby(@Query(new ZodPipe(querySchema)) q: z.infer<typeof querySchema>) {
    return this.places.nearby(q.lat, q.lng);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { EventsService } from './events.service';
import { coarse } from './geo-sql';
import { NEARBY_KINDS, NEARBY_VISIBILITY, NEARBY_WHEN, NearbyKind, NearbyService } from './nearby.service';

type AuthedReq = Request & { userId?: string };

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
const nearbyQuery = z.object({
  lat,
  lng,
  radiusKm: z.coerce.number().min(5).max(30).default(10),
  kinds: z
    .string()
    .optional()
    .transform((s, ctx) => {
      if (!s) return new Set<NearbyKind>(NEARBY_KINDS);
      const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
      const bad = parts.filter((x) => !(NEARBY_KINDS as readonly string[]).includes(x));
      if (bad.length || !parts.length) {
        ctx.addIssue({ code: 'custom', message: `Tipos válidos: ${NEARBY_KINDS.join(', ')}` });
        return z.NEVER;
      }
      return new Set(parts as NearbyKind[]);
    }),
  when: z.enum(NEARBY_WHEN).default('week'),
});
const placesQuery = z.object({ q: z.string().max(60).default(''), lat, lng });
const settingsSchema = z.object({ visibility: z.enum(NEARBY_VISIBILITY) });
const presenceSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

const isoDate = z.iso.datetime({ offset: true });
const eventFields = {
  description: z.string().trim().max(500).nullable().optional(),
  endsAt: isoDate.nullable().optional(),
  coverMediaId: z.string().uuid().nullable().optional(),
};
const createEventSchema = z.object({ venueSlug: z.string().trim().min(3).max(60), title: z.string().trim().min(2).max(80), startsAt: isoDate, ...eventFields });
const updateEventSchema = z.object({ title: z.string().trim().min(2).max(80).optional(), startsAt: isoDate.optional(), ...eventFields });

/**
 * "À tua volta". A posição de quem pede é arredondada aqui (2 casas, ~1 km) antes de chegar ao serviço,
 * e nunca é guardada nem escrita no registo.
 */
@Controller('nearby')
@UseGuards(JwtAuthGuard)
export class NearbyController {
  constructor(private readonly nearby: NearbyService) {}

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  around(@Req() req: AuthedReq, @Query(new ZodPipe(nearbyQuery)) q: z.infer<typeof nearbyQuery>) {
    return this.nearby.around(req.userId!, { lat: coarse(q.lat), lng: coarse(q.lng) }, q.radiusKm, q.kinds, q.when);
  }

  /** Caixa de pesquisa do mapa: locais e eventos até 30 km. */
  @Get('places')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  places(@Req() req: AuthedReq, @Query(new ZodPipe(placesQuery)) q: z.infer<typeof placesQuery>) {
    return this.nearby.places(req.userId!, { lat: coarse(q.lat), lng: coarse(q.lng) }, q.q);
  }

  /** Quem me pode ver no mapa. */
  @Get('settings')
  settings(@Req() req: AuthedReq) {
    return this.nearby.settings(req.userId!);
  }

  @Put('settings')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  setSettings(@Req() req: AuthedReq, @Body(new ZodPipe(settingsSchema)) b: z.infer<typeof settingsSchema>) {
    return this.nearby.setVisibility(req.userId!, b.visibility);
  }

  /** Aparecer no mapa: só se guarda a quadrícula (~1,5 km). Cada pessoa actualiza no máximo ~1 vez por minuto (no serviço). */
  @Post('presence')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  presence(@Req() req: AuthedReq, @Body(new ZodPipe(presenceSchema)) b: z.infer<typeof presenceSchema>) {
    return this.nearby.setPresence(req.userId!, b.lat, b.lng);
  }

  @Delete('presence')
  clearPresence(@Req() req: AuthedReq) {
    return this.nearby.clearPresence(req.userId!);
  }
}

/** Eventos dos locais. */
@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  create(@Req() req: AuthedReq, @Body(new ZodPipe(createEventSchema)) b: z.infer<typeof createEventSchema>) {
    return this.events.create(req.userId!, b);
  }

  @Get(':id')
  get(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.events.get(req.userId!, id);
  }

  @Patch(':id')
  update(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(updateEventSchema)) b: z.infer<typeof updateEventSchema>) {
    return this.events.update(req.userId!, id, b);
  }

  /** Cancela (não apaga). */
  @Delete(':id')
  cancel(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.events.cancel(req.userId!, id);
  }

  @Put(':id/interest')
  interested(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.events.setInterest(req.userId!, id, true);
  }

  @Delete(':id/interest')
  notInterested(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.events.setInterest(req.userId!, id, false);
  }
}

/** Próximos eventos de um local (fora do controlador dos locais, que é de outra equipa). */
@Controller('venues-events')
@UseGuards(JwtAuthGuard)
export class VenueEventsController {
  constructor(private readonly events: EventsService) {}

  @Get(':slug')
  upcoming(@Req() req: AuthedReq, @Param('slug') slug: string) {
    return this.events.upcoming(req.userId!, slug);
  }
}

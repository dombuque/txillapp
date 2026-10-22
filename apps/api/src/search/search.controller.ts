import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/auth.controller';
import { SearchService } from './search.service';

@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  find(@Req() req: Request & { userId?: string }, @Query('q') q = '') {
    return this.search.search(req.userId!, q);
  }
}

import { Controller, Get, NotFoundException, Param, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { PostsService } from '../posts/posts.service';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/auth.controller';
import { SearchService } from './search.service';

@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** Hashtags em alta (últimas 48 h). */
  @Get('trending')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  trending(@Req() req: Request & { userId?: string }) {
    return this.search.trending(req.userId!);
  }

  /** Hashtags que começam por ... (para completar enquanto se escreve #). */
  @Get('tags')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async tags(@Req() req: Request & { userId?: string }, @Query('q') q = '') {
    return { tags: await this.search.tagsLike(req.userId!, q.slice(0, 31)) };
  }

  /** Pessoas e hashtags enquanto se escreve (poucos resultados, resposta rápida). */
  @Get('suggest')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  suggest(@Req() req: Request & { userId?: string }, @Query('q') q = '') {
    return this.search.suggest(req.userId!, q.slice(0, 50));
  }

  @Get()
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  find(@Req() req: Request & { userId?: string }, @Query('q') q = '') {
    return this.search.search(req.userId!, q);
  }
}

const tagSchema = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(30).default(10), sort: z.enum(['recent', 'top']).default('recent') });

/** Página de uma hashtag: quantas publicações e as publicações (recentes ou mais reagidas). */
@Controller('tags')
@UseGuards(JwtAuthGuard)
export class TagsController {
  constructor(
    private readonly search: SearchService,
    private readonly posts: PostsService,
  ) {}

  @Get(':tag')
  async one(@Req() req: Request & { userId?: string }, @Param('tag') tag: string, @Query(new ZodPipe(tagSchema)) q: z.infer<typeof tagSchema>) {
    const info = await this.search.tagInfo(req.userId!, tag);
    if (!info) throw new NotFoundException('Hashtag inválida');
    return { ...info, ...(await this.posts.byTag(req.userId!, info.tag, q.sort, q.cursor, q.limit)) };
  }
}

import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';
import client from 'prom-client';
import { registry } from '../observability/metrics';

const fallbacks = new client.Counter({ name: 'throttler_redis_fallback_total', help: 'Contagens de limites feitas na memória porque o Redis falhou', registers: [registry] });

/**
 * Os limites de pedidos (o geral de 120 por minuto e os @Throttle) contados no Redis, iguais em todas as instâncias
 * (@nest-lab/throttler-storage-redis, compatível com o @nestjs/throttler 6). Se o Redis falhar, essa contagem faz-se na
 * memória desta instância: o pedido nunca falha por causa do Redis (fica só menos apertado enquanto durar a falha).
 * Os limites próprios contados na base de dados (montagens por hora, pré-visualizações de voz…) não passam por aqui.
 */
export class SharedThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly log = new Logger('Limites');
  private readonly redis: ThrottlerStorageRedisService;
  private readonly memory = new ThrottlerStorageService();
  private lastWarn = 0;

  constructor(redis: Redis) {
    this.redis = new ThrottlerStorageRedisService(redis);
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string) {
    try {
      return await this.redis.increment(`th:${key}`, ttl, limit, blockDuration, throttlerName);
    } catch (e) {
      fallbacks.inc();
      const now = Date.now();
      if (now - this.lastWarn > 60_000) {
        this.lastWarn = now;
        this.log.warn(`Redis indisponível para os limites: ${(e as Error).message}. A contar nesta instância.`);
      }
      return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  onApplicationShutdown() {
    this.memory.onApplicationShutdown();
  }
}

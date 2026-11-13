import { Global, Inject, Logger, Module, OnApplicationShutdown, OnModuleInit, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import { AppConfig, CONFIG } from '../config';
import { MemoryRealtimeBus, RealtimeBus, RedisRealtimeBus } from './realtime-bus';
import { connectRedis, REDIS, waitReady } from './redis';
import { Scheduler } from './scheduler';

const REDIS_SUB = Symbol('REDIS_SUB');

/**
 * A base da escala (docs/escala.md): o Redis (se houver REDIS_URL), o RealtimeBus (Redis ou memória) e o Scheduler das
 * tarefas periódicas. Global: qualquer serviço injeta RealtimeBus, Scheduler ou REDIS.
 */
@Global()
@Module({
  providers: [
    { provide: REDIS, inject: [CONFIG], useFactory: (c: AppConfig) => (c.REDIS_URL ? connectRedis(c, 'cmd') : null) },
    { provide: REDIS_SUB, inject: [CONFIG], useFactory: (c: AppConfig) => (c.REDIS_URL ? connectRedis(c, 'sub') : null) },
    {
      provide: RealtimeBus,
      inject: [REDIS, REDIS_SUB],
      useFactory: (redis: Redis | null, sub: Redis | null) => (redis && sub ? new RedisRealtimeBus(redis, sub) : new MemoryRealtimeBus()),
    },
    Scheduler,
  ],
  exports: [REDIS, RealtimeBus, Scheduler],
})
export class RealtimeModule implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('Tempo real');

  constructor(
    private readonly bus: RealtimeBus,
    @Optional() @Inject(REDIS) private readonly redis: Redis | null,
    @Optional() @Inject(REDIS_SUB) private readonly sub: Redis | null,
  ) {}

  async onModuleInit() {
    if (!this.redis || !this.sub) return;
    const [a, b] = await Promise.all([waitReady(this.redis), waitReady(this.sub)]);
    if (a && b) this.log.log('tempo real e limites partilhados pelo Redis');
    else this.log.warn('o Redis ainda não respondeu: até ligar, esta instância usa a memória dela');
  }

  async onApplicationShutdown() {
    await this.bus.close();
    for (const r of [this.redis, this.sub]) if (r) await r.quit().catch(() => r.disconnect());
  }
}

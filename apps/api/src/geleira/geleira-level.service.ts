import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { refreshDue } from './geleira-level';

/** De quanto em quanto tempo a volta corre. */
export const LEVEL_EVERY_MS = 3_600_000;

/**
 * A volta de hora a hora do nível da geleira (0146): refaz a conta de quem mudou alguma coisa e de quem tem pontos (o nível
 * desce devagar quando a pessoa deixa de sair, mesmo que ninguém lhe abra o perfil). O mesmo mecanismo da sexta da gelada:
 * um temporizador; nos testes chama-se `run()`.
 */
@Injectable()
export class GeleiraLevelService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('NivelDaGeleira');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    if (this.config.NODE_ENV === 'test') return;
    const tick = () => void this.run().catch((e) => this.log.warn(`falha no nível da geleira: ${(e as Error).message}`));
    this.timer = setInterval(tick, LEVEL_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Refaz em lotes até não haver mais nada para refazer (no máximo 20 lotes por volta). */
  async run(opts: { now?: Date; limit?: number } = {}): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      let total = 0;
      for (let i = 0; i < 20; i++) {
        const n = await refreshDue(this.pool, opts);
        total += n;
        if (n < (opts.limit ?? 500)) break;
      }
      return total;
    } finally {
      this.running = false;
    }
  }
}

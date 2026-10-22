import { Global, Module, OnApplicationShutdown, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config';

export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [CONFIG],
      useFactory: (config: AppConfig) => new Pool({ connectionString: config.DATABASE_URL, max: 10 }),
    },
  ],
  exports: [PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}

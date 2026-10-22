import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfig, CONFIG } from './config';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { MediaModule } from './media/media.module';
import { PostsModule } from './posts/posts.module';
import { WalletModule } from './wallet/wallet.module';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        // TODO(fase 3): storage em Redis para limites partilhados entre instâncias.
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
        DbModule,
        AuthModule,
        WalletModule,
        MediaModule,
        PostsModule,
      ],
      controllers: [HealthController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
      exports: [CONFIG],
    };
  }
}

import { DynamicModule, Module } from '@nestjs/common';
import type { JWTVerifyGetKey } from 'jose';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfig, CONFIG } from './config';
import { AuthModule } from './auth/auth.module';
import { GOOGLE_JWKS } from './auth/google.service';
import { CommentsModule } from './comments/comments.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { MediaModule } from './media/media.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PlacesModule } from './places/places.module';
import { PostsModule } from './posts/posts.module';
import { SearchModule } from './search/search.module';
import { SocialModule } from './social/social.module';
import { StoriesModule } from './stories/stories.module';
import { WalletModule } from './wallet/wallet.module';

@Module({})
export class AppModule {
  /** `googleJwks`: chaves públicas para validar tokens da Google; só os testes as substituem. */
  static register(config: AppConfig, opts: { googleJwks?: JWTVerifyGetKey } = {}): DynamicModule {
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
        NotificationsModule,
        PlacesModule,
        PostsModule,
        CommentsModule,
        StoriesModule,
        SocialModule,
        SearchModule,
      ],
      controllers: [HealthController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: GOOGLE_JWKS, useValue: opts.googleJwks ?? null },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
      exports: [CONFIG, GOOGLE_JWKS],
    };
  }
}

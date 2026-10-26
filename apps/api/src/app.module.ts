import { DynamicModule, Module } from '@nestjs/common';
import type { JWTVerifyGetKey } from 'jose';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfig, CONFIG } from './config';
import { AnalyticsModule } from './analytics/analytics.module';
import { MetricsController } from './observability/metrics';
import { AccountModule } from './account/account.module';
import { AuthModule } from './auth/auth.module';
import { GOOGLE_JWKS } from './auth/google.service';
import { Client } from '@elastic/elasticsearch';
import { ES_CLIENT, SearchIndexModule } from './search/search-index';
import { IMAGE_CLASSIFIER, type ImageClassifier } from './moderation/image-moderation.service';
import { ChatModule } from './chat/chat.module';
import { CommentsModule } from './comments/comments.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { MediaModule } from './media/media.module';
import { ModerationModule } from './moderation/moderation.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PushModule } from './push/push.module';
import { PlacesModule } from './places/places.module';
import { PostsModule } from './posts/posts.module';
import { SearchModule } from './search/search.module';
import { SocialModule } from './social/social.module';
import { StoriesModule } from './stories/stories.module';
import { WalletModule } from './wallet/wallet.module';

@Module({})
export class AppModule {
  /** `googleJwks`: chaves públicas para validar tokens da Google; só os testes as substituem. */
  static register(config: AppConfig, opts: { googleJwks?: JWTVerifyGetKey; imageClassifier?: ImageClassifier; esClient?: Client } = {}): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        // TODO(fase 3): storage em Redis para limites partilhados entre instâncias.
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
        DbModule,
        AuthModule,
        SearchIndexModule,
        AccountModule,
        AnalyticsModule,
        WalletModule,
        MediaModule,
        PushModule,
        NotificationsModule,
        PlacesModule,
        PostsModule,
        CommentsModule,
        ChatModule,
        ModerationModule,
        StoriesModule,
        SocialModule,
        SearchModule,
      ],
      controllers: [HealthController, MetricsController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: GOOGLE_JWKS, useValue: opts.googleJwks ?? null },
        { provide: IMAGE_CLASSIFIER, useValue: opts.imageClassifier ?? null },
        {
          provide: ES_CLIENT,
          useValue:
            opts.esClient ??
            (config.SEARCH_BACKEND === 'elasticsearch'
              ? new Client({ node: config.ELASTICSEARCH_URL!, ...(config.ELASTICSEARCH_API_KEY ? { auth: { apiKey: config.ELASTICSEARCH_API_KEY } } : {}) })
              : null),
        },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
      exports: [CONFIG, GOOGLE_JWKS, IMAGE_CLASSIFIER, ES_CLIENT],
    };
  }
}

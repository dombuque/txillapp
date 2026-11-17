import { DynamicModule, Module } from '@nestjs/common';
import type { JWTVerifyGetKey } from 'jose';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { I18nExceptionFilter } from './i18n/i18n.filter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfig, CONFIG } from './config';
import { AnalyticsModule } from './analytics/analytics.module';
import { MetricsController } from './observability/metrics';
import { AccountModule } from './account/account.module';
import { MailModule } from './mail/mail.module';
import { SecurityModule } from './security/security.module';
import { AuthModule } from './auth/auth.module';
import { APPLE_JWKS } from './auth/apple.service';
import { GOOGLE_JWKS } from './auth/google.service';
import { Client } from '@elastic/elasticsearch';
import { ES_CLIENT, SearchIndexModule } from './search/search-index';
import { BODY_DETECTOR, IMAGE_CLASSIFIER, type BodyPartDetector, type ImageClassifier } from './moderation/image-moderation.service';
import { ChatModule } from './chat/chat.module';
import { CallsModule } from './calls/calls.module';
import { MusicModule } from './music/music.module';
import { ArtistsModule } from './artists/artists.module';
import { GifsModule } from './gifs/gifs.module';
import { SafetyModule } from './safety/safety.module';
import { VerificationModule } from './verification/verification.module';
import { CommentsModule } from './comments/comments.module';
import { DbModule } from './db/db.module';
import { GeleiraModule } from './geleira/geleira.module';
import { GeladaModule } from './gelada/gelada.module';
import { MixarModule } from './mixar/mixar.module';
import { HealthController } from './health/health.controller';
import { MediaModule } from './media/media.module';
import { ModerationModule } from './moderation/moderation.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PushModule } from './push/push.module';
import { PlacesModule } from './places/places.module';
import { PostsModule } from './posts/posts.module';
import { SearchModule } from './search/search.module';
import { SocialModule } from './social/social.module';
import { InstantsModule } from './instants/instants.module';
import { StoriesModule } from './stories/stories.module';
import { WalletModule } from './wallet/wallet.module';
import { InvitesModule } from './invites/invites.module';
import { BackofficeModule } from './backoffice/backoffice.module';
import { InsightsModule } from './insights/insights.module';
import { StaffModule } from './staff/staff.module';
import { VenuesModule } from './venues/venues.module';
import { NearbyModule } from './nearby/nearby.module';
import { RemindersModule } from './reminders/reminders.module';
import { SuperTxillModule } from './supertxill/supertxill.module';
import { PaymentsModule } from './payments/payments.module';
import { BoostsModule } from './boosts/boosts.module';
import { FinModule } from './backoffice/fin.module';
import { IapModule } from './iap/iap.module';
import { ComposeModule } from './compose/compose.module';
import { TxilladaModule } from './txillada/txillada.module';
import { LIVEKIT_ROOMS, livekitRoomsFromConfig, type LiveKitRooms } from './txillada/livekit';
import type Redis from 'ioredis';
import { RealtimeModule } from './realtime/realtime.module';
import { REDIS } from './realtime/redis';
import { SharedThrottlerStorage } from './realtime/throttler-storage';

@Module({})
export class AppModule {
  /** `googleJwks`: chaves públicas para validar tokens da Google; só os testes as substituem. */
  static register(config: AppConfig, opts: { googleJwks?: JWTVerifyGetKey; appleJwks?: JWTVerifyGetKey; imageClassifier?: ImageClassifier; bodyDetector?: BodyPartDetector; esClient?: Client; livekitRooms?: LiveKitRooms | null } = {}): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        RealtimeModule,
        // O limite geral (120 pedidos por minuto) e os @Throttle: contados no Redis, iguais em todas as instâncias
        // (sem REDIS_URL, na memória do processo, como antes). Ver realtime/throttler-storage.ts.
        ThrottlerModule.forRootAsync({
          inject: [REDIS],
          useFactory: (redis: Redis | null) => ({ throttlers: [{ ttl: 60_000, limit: 120 }], ...(redis ? { storage: new SharedThrottlerStorage(redis) } : {}) }),
        }),
        DbModule,
        MailModule,
        SecurityModule,
        AuthModule,
        SearchIndexModule,
        AccountModule,
        AnalyticsModule,
        WalletModule,
        InvitesModule,
        StaffModule,
        VenuesModule,
        NearbyModule,
        RemindersModule,
        InsightsModule,
        SuperTxillModule,
        BackofficeModule,
        PaymentsModule,
        BoostsModule,
        FinModule,
        IapModule,
        MediaModule,
        PushModule,
        NotificationsModule,
        PlacesModule,
        GeleiraModule,
        GeladaModule,
        MixarModule,
        PostsModule,
        CommentsModule,
        ChatModule,
        CallsModule,
        MusicModule,
        ArtistsModule,
        GifsModule,
        SafetyModule,
        VerificationModule,
        ModerationModule,
        StoriesModule,
        InstantsModule,
        SocialModule,
        SearchModule,
        ComposeModule,
        TxilladaModule,
      ],
      controllers: [HealthController, MetricsController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: GOOGLE_JWKS, useValue: opts.googleJwks ?? null },
        { provide: APPLE_JWKS, useValue: opts.appleJwks ?? null },
        { provide: IMAGE_CLASSIFIER, useValue: opts.imageClassifier ?? null },
        { provide: BODY_DETECTOR, useValue: opts.bodyDetector ?? null },
        {
          provide: ES_CLIENT,
          useValue:
            opts.esClient ??
            (config.SEARCH_BACKEND === 'elasticsearch'
              ? new Client({ node: config.ELASTICSEARCH_URL!, ...(config.ELASTICSEARCH_API_KEY ? { auth: { apiKey: config.ELASTICSEARCH_API_KEY } } : {}) })
              : null),
        },
        // O LiveKit da Txillada (tirar pessoas, fechar salas). Sem LIVEKIT_*, null. Os testes passam um falso.
        { provide: LIVEKIT_ROOMS, useValue: opts.livekitRooms !== undefined ? opts.livekitRooms : livekitRoomsFromConfig(config) },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        // Os erros no idioma do pedido (src/i18n, docs/idiomas-api.md).
        { provide: APP_FILTER, useClass: I18nExceptionFilter },
      ],
      exports: [CONFIG, GOOGLE_JWKS, APPLE_JWKS, IMAGE_CLASSIFIER, BODY_DETECTOR, ES_CLIENT, LIVEKIT_ROOMS],
    };
  }
}

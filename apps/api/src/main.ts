import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { metricsMiddleware } from './observability/metrics';
import helmet from 'helmet';
import type { JWTVerifyGetKey } from 'jose';
import { AppModule } from './app.module';
import { loadConfig } from './config';

export async function createApp(config = loadConfig(), opts: { googleJwks?: JWTVerifyGetKey; imageClassifier?: import('./moderation/image-moderation.service').ImageClassifier; esClient?: import('@elastic/elasticsearch').Client } = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config, opts));
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(metricsMiddleware);
  // JSON e texto mais leves (as fotos já vêm comprimidas). O canal em tempo real (SSE) NUNCA se comprime:
  // a compressão guarda os bytes em memória até encher e as mensagens chegariam com atraso.
  app.use(compression({ filter: (req, res) => !String(res.getHeader('Content-Type') ?? '').includes('text/event-stream') && compression.filter(req, res) }));
  app.use(cookieParser());
  // WEB_ORIGIN pode listar várias origens separadas por vírgula (por exemplo app e admin).
  app.enableCors({ origin: config.WEB_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean), credentials: true });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  if (config.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Txillapp API').setVersion('1').addBearerAuth().build());
    SwaggerModule.setup('api/docs', app, doc);
  }
  return app;
}

if (require.main === module) {
  const config = loadConfig();
  createApp(config).then((app) => app.listen(config.PORT));
}

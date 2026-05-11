// src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Required for HMAC webhook signature verification
    logger: ['log', 'warn', 'error'],
  });

  const logger = new Logger('Bootstrap');

  // ── Security ────────────────────────────────────────────────────────────
  app.use(helmet());
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? false,
    methods: ['GET', 'POST', 'PATCH'],
  });

  // ── Global validation ───────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,         // Strip unknown fields
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── API prefix ──────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ── Swagger (non-production only) ───────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Lex Tally Sync Service')
      .setDescription(
        'Internal microservice bridging TallyPrime with the Lex SaaS platform.\n\n' +
        '**Internal endpoints** (`/internal/activation/*`) require `X-Lex-Signature` HMAC header.\n\n' +
        '**Sync endpoints** (`/tally/sync/*`) require `X-API-Key` + `X-API-Secret` headers.',
      )
      .setVersion('1.0')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'apiKey')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
    logger.log('Swagger docs available at /docs');
  }

  const port = process.env.PORT ?? 8009;
  await app.listen(port);
  logger.log(`lex-tally-sync-service running on port ${port}`);
}

bootstrap();

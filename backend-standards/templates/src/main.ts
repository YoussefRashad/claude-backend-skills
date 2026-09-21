import { ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import { json, urlencoded } from 'express';
import helmet from 'helmet';

import { correlationIdMiddleware } from './common/correlation-id.middleware';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './interceptors/response-envelope.interceptor';
import { AppModule } from './app.module';

/**
 * Bootstrap.
 *
 * Every line below that carries a comment is enforcing a rule from the standard.
 * Read the comment before changing the line.
 */

/**
 * .ai/standards/01-engineering-standards.md §15 — "Missing required configuration MUST
 * fail the boot, loudly."
 *
 * Bootstrap runs before the DI container exists, so it cannot use the validated config
 * accessor that the rest of the service uses. This is the one place raw `process.env`
 * is acceptable — and it is acceptable only because a missing value stops the process
 * here rather than producing a quietly wrong setting that surfaces months later.
 *
 * Everything else MUST go through the validated configuration layer (§15).
 */
function requireEnv(name: string): string {
  // eslint-disable-next-line security/detect-object-injection -- name is a literal supplied by this file, never a request value
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(
      `Missing required environment variable ${name}. Refusing to boot (01 §15). ` +
        `Set it explicitly — an empty value is a valid, deliberate choice; an absent one is not.`,
    );
  }
  return value;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const reflector = app.get(Reflector);

  // 01 §14 — correlation ID, before anything that logs. MUST, not SHOULD.
  app.use(correlationIdMiddleware);

  // 01 §5 — body limits are set EXPLICITLY, not inherited from a framework default.
  // The default is 100kb; stating it makes it a decision someone can find and change.
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  app.use(compression());
  app.use(helmet());

  // 02 §9 — exact-match allowlist. Never a wildcard, never reflect the origin.
  // ALLOWED_ORIGINS must be SET. Empty is legitimate (a server-to-server service with
  // no browser clients) but it has to be chosen, because an accidentally-empty
  // allowlist and a deliberately-empty one are indistinguishable after the fact.
  app.enableCors({
    origin: requireEnv('ALLOWED_ORIGINS').split(',').filter(Boolean),
    credentials: false,
  });

  // Behind a proxy: rate limiting and IP logging need the real client address.
  // 02 §9 — the throttler in common/rate-limit.ts keys on req.ip, which is only the
  // real client address because of this line. The two go together.
  app.set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      // 01 §5 — DECISION (Youssef Farag, 2026-09-20): forbidNonWhitelisted is OFF.
      // Unknown fields are stripped silently rather than rejected, so a newer app
      // version sending an extra field keeps working against an older backend.
      //
      // The cost, so it is not rediscovered the hard way: a field the client sends
      // and the backend never reads fails silently. Where an endpoint's contract
      // matters enough to fail loudly, turn it on for THAT route:
      //   @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // 01 §4 — ONE filter, ONE error shape.
  app.useGlobalFilters(new AllExceptionsFilter());

  // 01 §4 — the envelope is all-or-nothing within a service. Registering it
  // globally is what makes that true; opt a route out with @RawResponse() only
  // for bodies that are not ours to shape.
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor(reflector));

  // 01 §12 — enables the shutdown sequence. Queue consumers must be paused and
  // drained in onApplicationShutdown; removing listeners is not a drain.
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);

  // ETag causes 304s on API responses that clients rarely want.
  app.getHttpAdapter().getInstance().disable('etag');

  await app.listen(Number(process.env.PORT ?? 3000));
}

/*
 * 02 §9 — rate limiting is global and therefore lives in AppModule, not here:
 *   imports:   [ThrottlerModule.forRoot(throttlerRootOptions)]
 *   providers: [ThrottlerGuardProvider]
 * See common/rate-limit.ts. Without it this service violates a MUST in the security
 * floor from its first commit.
 */

void bootstrap();

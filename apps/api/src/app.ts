import 'reflect-metadata';
import { BadRequestException, Module, ValidationPipe, VersioningType } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerModule } from '@nestjs/throttler';
import { IdentityThrottlerGuard } from './platform/throttle.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import   helmet   from "helmet" ;
import {
  AuthGuard,
  Config,
  PlatformModule,
  ProblemFilter,
  RequireIdentityGuard,
  requestTelemetry,
} from './platform/index.js';
import { ProjectsModule } from './projects/index.js';
import { DeadlineInterceptor, requestDeadline } from './platform/deadline.js';
import type { Server } from 'node:http';
import {
  bodyParserErrors,
  fieldErrors,
  limitJsonDepth,
  privateNoStore,
  problemSchema,
  requireJsonBody,
} from './platform/errors.js';
import { capacityLimit } from './platform/capacity.js';
import { LimitStorage } from './platform/limiter.js';

@Module({
  imports: [
    PlatformModule,
    ProjectsModule,
    ThrottlerModule.forRootAsync({
      imports: [PlatformModule],
      inject: [Config, LimitStorage],
      useFactory: (config: Config, storage: LimitStorage) => ({
        storage,
        throttlers: [{ ttl: config.rateWindowMs, limit: config.rateLimit }],
      }),
    }),
  ],
  providers: [
    // Order matters: 1) verify the token and record the outcome, 2) rate-limit per verified user (or per IP when
    // unauthenticated, so token-guessing floods are limited too), 3) reject requests without an identity.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: IdentityThrottlerGuard },
    { provide: APP_GUARD, useClass: RequireIdentityGuard },
  ],
})
class AppModule {}

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: false,
    abortOnError: false,
  });
  app.use(requestTelemetry);
  app.use(requestDeadline);
  app.use(helmet());
  app.use(capacityLimit(app.get(Config).maxInFlight));
  app.useBodyParser('json', { limit: '32kb' });
  app.use(bodyParserErrors);
  app.use(requireJsonBody);
  app.use(limitJsonDepth);
  app.use('/v1', privateNoStore);
  const config = app.get(Config);
  app.set('trust proxy', config.trustedProxies.length ? config.trustedProxies : false);
  if (config.webOrigin) app.enableCors({ origin: config.webOrigin, credentials: false });
  // URI versioning: resource controllers opt in (`/v1/projects`); health stays unversioned for probes.
  app.enableVersioning({ type: VersioningType.URI });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => new BadRequestException({ message: fieldErrors(errors) }),
    }),
  );
  app.useGlobalFilters(new ProblemFilter());
  app.useGlobalInterceptors(new DeadlineInterceptor());
  const server = app.getHttpServer() as Server;
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 5000;
  // Node only enforces the two timeouts above when it sweeps connections (default every 30 s), so a slow client could
  // hold a socket for up to 30 s longer. Sweep every second. Read at listen time, so it must be set before listen.
  (server as Server & { connectionsCheckingInterval: number }).connectionsCheckingInterval = 1000;
  return app;
}
export function contract(app: Awaited<ReturnType<typeof createApp>>) {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Projects reference').setVersion('1.0.0').addBearerAuth().build(),
  );
  // The ValidationPipe rejects unknown body fields (forbidNonWhitelisted), so the contract must say so too.
  for (const route of Object.values(document.paths))
    for (const operation of Object.values(route) as {
      requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> };
    }[]) {
      const ref = operation?.requestBody?.content?.['application/json']?.schema?.$ref;
      const schema = ref ? document.components?.schemas?.[ref.split('/').pop() ?? ''] : undefined;
      if (schema && typeof schema === 'object' && !('$ref' in schema)) schema.additionalProperties = false;
    }
  // One shared RFC 9457 schema; every problem response references it.
  document.components = {
    ...document.components,
    schemas: { ...document.components?.schemas, ProblemDetails: problemSchema },
  };
  return document;
}

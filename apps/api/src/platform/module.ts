import { Module } from '@nestjs/common';
import { Config } from './config.js';
import { Database } from './database.js';
import { AuthGuard } from './auth.js';
import { HealthController } from './health.js';
import { LimitStorage } from './limiter.js';
@Module({
  controllers: [HealthController],
  providers: [Config, Database, AuthGuard, LimitStorage],
  exports: [Config, Database, AuthGuard, LimitStorage],
})
export class PlatformModule {}

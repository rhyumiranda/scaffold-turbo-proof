import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Database } from './database.js';
import { ApiOkResponse } from '@nestjs/swagger';
import { ApiProblems } from './errors.js';
import { Public } from './auth.js';
import { SkipThrottle } from '@nestjs/throttler';
import { LimitStorage } from './limiter.js';
@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly db: Database,
    private readonly limiter: LimitStorage,
  ) {}
  @Get('live')
  @ApiOkResponse({
    schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['ok'] } } },
  })
  live() {
    return { status: 'ok' };
  }
  @Get('ready')
  @ApiProblems(503)
  @ApiOkResponse({
    schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['ready'] } } },
  })
  async ready() {
    try {
      await Promise.all([this.db.query('SELECT 1'), this.limiter.ready()]);
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}

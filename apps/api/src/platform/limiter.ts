import { Injectable, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { createClient } from '@redis/client';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import { Config } from './config.js';
import { createHash } from 'node:crypto';

const script = `
local blocked=redis.call('PTTL',KEYS[2])
if blocked>0 then return {tonumber(ARGV[2])+1,blocked,1,blocked} end
local hits=redis.call('INCR',KEYS[1])
if hits==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end
local remaining=redis.call('PTTL',KEYS[1])
if hits>tonumber(ARGV[2]) then
 redis.call('SET',KEYS[2],'1','PX',ARGV[3]);return {hits,remaining,1,tonumber(ARGV[3])}
end
return {hits,remaining,0,0}`;

@Injectable()
export class LimitStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly memory = new ThrottlerStorageService();
  private readonly redis: ReturnType<typeof createClient> | undefined;
  private connecting: Promise<unknown> | undefined;
  constructor(private readonly config: Config) {
    if (config.limiterMode === 'redis') {
      this.redis = createClient({
        url: config.redisUrl!,
        socket: { connectTimeout: 1000, reconnectStrategy: false },
        disableOfflineQueue: true,
      });
      this.redis.on('error', () => {});
    }
  }
  async increment(key: string, ttl: number, limit: number, blockDuration: number, name: string) {
    if (!this.redis) return this.memory.increment(key, ttl, limit, blockDuration, name);
    const client = this.redis;
    try {
      if (!client.isOpen) {
        this.connecting ??= client.connect().finally(() => {
          this.connecting = undefined;
        });
        await this.connecting;
      }
      if (this.connecting) await this.connecting;
      // Hash tag keeps both keys on the same Redis Cluster slot; no raw identity in keys.
      const id =
        '{' +
        this.config.limiterNamespace +
        ':' +
        createHash('sha256')
          .update(name + ':' + key)
          .digest('hex') +
        '}';
      const result = (await client.withCommandOptions({ abortSignal: AbortSignal.timeout(1000) }).eval(script, {
        keys: [id + ':hits', id + ':block'],
        arguments: [String(ttl), String(limit), String(blockDuration)],
      })) as number[];
      return {
        totalHits: result[0]!,
        timeToExpire: Math.ceil(result[1]! / 1000),
        isBlocked: result[2] === 1,
        timeToBlockExpire: Math.ceil(result[3]! / 1000),
      };
    } catch {
      throw new ServiceUnavailableException('Limiter unavailable');
    }
  }
  async ready() {
    if (!this.redis) return;
    try {
      if (!this.redis.isOpen) {
        this.connecting ??= this.redis.connect().finally(() => {
          this.connecting = undefined;
        });
      }
      if (this.connecting) await this.connecting;
      await this.redis.withCommandOptions({ abortSignal: AbortSignal.timeout(1000) }).ping();
    } catch {
      throw new ServiceUnavailableException('Limiter unavailable');
    }
  }
  onApplicationShutdown() {
    if (this.redis?.isOpen) this.redis.destroy();
    this.memory.onApplicationShutdown();
  }
}

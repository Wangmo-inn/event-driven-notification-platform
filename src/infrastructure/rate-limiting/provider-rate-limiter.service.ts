import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { providerRateLimited } from '../metrics/reliability.metrics';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { ILoggerService } from '../logger/interfaces/logger.service.interface';
import { LOGGER_SERVICE } from '../logger/logger.constants';

export type NotificationProviderName = 'sendgrid' | 'twilio';

/**
 * Thrown when a provider's outbound budget for the current window is spent. The worker treats it
 * like any transient failure, so BullMQ retries later with exponential backoff.
 */
export class ProviderRateLimitExceededException extends Error {
  constructor(
    public readonly provider: NotificationProviderName,
    public readonly limit: number,
  ) {
    super(`Rate limit exceeded for provider "${provider}" (max ${limit} requests/sec)`);
    this.name = 'ProviderRateLimitExceededException';
  }
}

/**
 * Fixed-window, per-provider limiter using atomic Redis INCR + EXPIRE. State lives in Redis,
 * so the limit holds across multiple worker processes.
 */
@Injectable()
export class ProviderRateLimiterService {
  private readonly limitsPerSecond: Record<NotificationProviderName, number>;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
    @Inject(LOGGER_SERVICE) private readonly logger: ILoggerService,
  ) {
    this.limitsPerSecond = {
      sendgrid: Number(this.configService.get('SENDGRID_RATE_LIMIT_PER_SEC', 10)),
      twilio: Number(this.configService.get('TWILIO_RATE_LIMIT_PER_SEC', 5)),
    };
  }

  async consume(provider: NotificationProviderName): Promise<void> {
    const limit = this.limitsPerSecond[provider];
    const windowKey = `ratelimit:${provider}:${Math.floor(Date.now() / 1000)}`;

    const count = await this.redis.incr(windowKey);
    if (count === 1) {
      await this.redis.expire(windowKey, 2);
    }

    if (count > limit) {
      this.logger.warn(`Provider "${provider}" rate limit exceeded (${count}/${limit} this second)`, 'ProviderRateLimiter.consume');
      providerRateLimited.inc({ provider });
      throw new ProviderRateLimitExceededException(provider, limit);
    }
  }

  async getCurrentUsage(provider: NotificationProviderName): Promise<{ used: number; limit: number }> {
    const windowKey = `ratelimit:${provider}:${Math.floor(Date.now() / 1000)}`;
    return { used: Number((await this.redis.get(windowKey)) ?? 0), limit: this.limitsPerSecond[provider] };
  }
}

import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { ProviderRateLimiterService } from './provider-rate-limiter.service';
import { RateLimitService } from './rate-limiter.service';

@Module({
  imports: [RedisModule],
  providers: [RateLimitService, ProviderRateLimiterService],
  exports: [RateLimitService, ProviderRateLimiterService],
})
export class RateLimitingModule {}

import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { InterceptorsModule } from './interceptors/interceptors.module';
import { LoggerModule } from './logger/logger.module';
import { MetricsModule } from './metrics/metrics.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { RateLimitingModule } from './rate-limiting/rate-limiting.module';
import { ResilienceModule } from './resilience/resilience.module';

@Module({
  imports: [LoggerModule, InterceptorsModule, AuditModule, MetricsModule, QueueModule, PrismaModule, RateLimitingModule, ResilienceModule],
  exports: [LoggerModule, InterceptorsModule, AuditModule, MetricsModule, QueueModule, PrismaModule, RateLimitingModule, ResilienceModule],
})
export class InfrastructureModule {}

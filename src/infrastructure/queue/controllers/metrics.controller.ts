import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { NotificationMetricsProvider } from '../../metrics/providers/notification.metrics.provider';
import { queueJobs, reliabilityRegistry } from '../../metrics/reliability.metrics';
import { QueueService } from '../queue.service';

/** Prometheus scrape endpoint: reliability metrics + queue depth + notification delivery metrics. */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly queueService: QueueService,
    private readonly notificationMetrics: NotificationMetricsProvider,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(): Promise<string> {
    // Queue depth is sampled at scrape time so it is always current.
    const stats = (await this.queueService.getQueueStats()) as Record<string, Record<string, number>>;
    for (const queue of ['notifications', 'dlq']) {
      for (const [state, count] of Object.entries(stats[queue] ?? {})) {
        queueJobs.set({ queue, state }, count);
      }
    }
    return `${await reliabilityRegistry.metrics()}\n${await this.notificationMetrics.getMetrics()}`;
  }
}

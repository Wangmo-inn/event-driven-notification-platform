import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { LOGGER_SERVICE } from 'src/infrastructure/logger/logger.constants';
import { ILoggerService } from 'src/infrastructure/logger/interfaces/logger.service.interface';
import { DLQ_QUEUE } from '../queue.constants';

/**
 * Worker for the dead-letter queue. The job is already persisted as DEAD_LETTER in Postgres; this
 * is the alerting hook (log loudly; in production page/Slack). Replay via POST /queue/dlq/retry.
 */
@Injectable()
@Processor(DLQ_QUEUE)
export class DlqProcessor extends WorkerHost {
  constructor(@Inject(LOGGER_SERVICE) private readonly logger: ILoggerService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { originalJobId, type, idempotencyKey, error } = job.data;
    this.logger.error(
      `[DLQ] Notification permanently failed - originalJobId=${originalJobId}, type=${type}, key=${idempotencyKey}, error=${error}`,
      'DlqProcessor.process',
    );
  }
}

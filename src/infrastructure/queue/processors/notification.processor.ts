import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { NotificationJob } from 'src/domain/interfaces/notification-job.interface';
import { NotificationRepository } from 'src/infrastructure/prisma/notification.repository';
import { LOGGER_SERVICE } from 'src/infrastructure/logger/logger.constants';
import { ILoggerService } from 'src/infrastructure/logger/interfaces/logger.service.interface';
import { NotificationService } from '../../../modules/notification/services/notification.service';
import { jobAttempts, jobDuration } from '../../metrics/reliability.metrics';
import { NOTIFICATIONS_QUEUE } from '../queue.constants';
import { QueueService } from '../queue.service';

/**
 * BullMQ consumer for the `notifications` queue (`@Processor` is what binds it to the queue).
 *
 * Idempotent consumer: before calling any provider the persisted status is checked; if it is
 * already SENT the job is a re-delivery (e.g. worker crashed after sending, before ack) and is a no-op.
 */
@Injectable()
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationProcessor extends WorkerHost {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly notificationRepository: NotificationRepository,
    private readonly queueService: QueueService,
    @Inject(LOGGER_SERVICE) private readonly logger: ILoggerService,
  ) {
    super();
  }

  async process(job: Job<NotificationJob>): Promise<void> {
    const ctx = `[${this.constructor.name}.process]`;
    const { type, data, idempotencyKey } = job.data;

    this.logger.log(`Processing job ${job.id} (attempt ${job.attemptsMade + 1}): ${type}`, ctx);

    if (idempotencyKey) {
      if ((await this.notificationRepository.getStatus(idempotencyKey)) === 'SENT') {
        this.logger.log(`Job ${job.id} already SENT (key ${idempotencyKey}) - duplicate delivery skipped`, ctx);
        jobAttempts.inc({ type, outcome: 'duplicate_skipped' });
        return;
      }
      await this.notificationRepository.markProcessing(idempotencyKey, job.id as string, job.attemptsMade);
    }

    const stopTimer = jobDuration.startTimer({ type });
    try {
      switch (type) {
        case 'notification':
          await this.notificationService.send(data);
          break;
        case 'welcome-email':
          await this.notificationService.sendWelcomeEmail(data);
          break;
        case 'verification-code':
          await this.notificationService.sendVerificationCode((data as { phoneNumber: string }).phoneNumber);
          break;
        default:
          throw new Error(`Unknown notification type: ${type as string}`);
      }

      if (idempotencyKey) await this.notificationRepository.markSent(idempotencyKey, this.getProviderName(type, data));
      jobAttempts.inc({ type, outcome: 'success' });
      stopTimer({ outcome: 'success' });
      this.logger.log(`Job ${job.id} processed successfully`, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      jobAttempts.inc({ type, outcome: 'failure' });
      stopTimer({ outcome: 'failure' });
      this.logger.error(`Job ${job.id} failed on attempt ${job.attemptsMade + 1}: ${message}`, ctx);
      if (idempotencyKey) await this.notificationRepository.markFailedAttempt(idempotencyKey, message, job.attemptsMade + 1);
      throw error; // BullMQ schedules the retry with exponential backoff
    }
  }

  /** Fired per failed attempt; once attempts are exhausted the job is moved to the DLQ. */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<NotificationJob> | undefined, error: Error): Promise<void> {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await this.queueService.sendToDeadLetterQueue(job, error);
    }
  }

  private getProviderName(type: NotificationJob['type'], data: NotificationJob['data']): string {
    if (type === 'verification-code') return 'twilio';
    if (type === 'welcome-email') return 'sendgrid';
    return data?.channel === 'SMS' ? 'twilio' : 'sendgrid';
  }
}

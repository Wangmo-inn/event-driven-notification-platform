import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Job, Queue } from 'bullmq';
import { CreateNotificationDto } from '../../application/dtos/create-notification.dto';
import { JOB_TYPE_PRIORITY } from '../../domain/enums/notification-priority.enum';
import { NotificationRepository, ReserveNotificationInput } from '../prisma/notification.repository';
import { ILoggerService } from '../logger/interfaces/logger.service.interface';
import { LOGGER_SERVICE } from '../logger/logger.constants';
import { deadLettered } from '../metrics/reliability.metrics';
import { DEFAULT_JOB_OPTIONS, DLQ_QUEUE, NOTIFICATIONS_QUEUE } from './queue.constants';

export type NotificationJobType = 'notification' | 'welcome-email' | 'verification-code';
export type NotificationJobData = CreateNotificationDto | { phoneNumber: string };

/** Jobs with no authenticated user (e.g. bare OTP sends) are attributed to the nil UUID. */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

export interface EnqueueResult {
  jobId: string;
  notificationId: string;
  /** true when an identical request (same idempotency key) was already accepted */
  duplicate: boolean;
}

/**
 * Producer API of the async pipeline. Idempotent at two layers: the idempotency key is a unique
 * column in Postgres (durable) AND the BullMQ jobId (queue-level dedupe).
 */
@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly notificationQueue: Queue,
    @InjectQueue(DLQ_QUEUE) private readonly dlqQueue: Queue,
    private readonly notificationRepository: NotificationRepository,
    @Inject(LOGGER_SERVICE) private readonly logger: ILoggerService,
  ) {}

  async enqueueNotification(
    type: NotificationJobType,
    data: NotificationJobData,
    explicitIdempotencyKey?: string,
  ): Promise<EnqueueResult> {
    const context = `${this.constructor.name}.enqueueNotification`;
    const idempotencyKey = explicitIdempotencyKey ?? this.buildIdempotencyKey(type, data);

    const reservation = await this.notificationRepository.reserve(this.toReserveInput(type, data, idempotencyKey));

    if (reservation.alreadyExists) {
      this.logger.log(`Duplicate suppressed for key "${idempotencyKey}" (status ${reservation.status})`, context);
      return { jobId: idempotencyKey, notificationId: reservation.id, duplicate: true };
    }

    const job = await this.notificationQueue.add(
      'process-notification',
      { type, data, idempotencyKey, timestamp: Date.now() },
      { ...DEFAULT_JOB_OPTIONS, jobId: idempotencyKey, priority: JOB_TYPE_PRIORITY[type] },
    );

    this.logger.log(`Enqueued ${type} job ${job.id} (priority ${JOB_TYPE_PRIORITY[type]})`, context);
    return { jobId: job.id as string, notificationId: reservation.id, duplicate: false };
  }

  /** Route a job that exhausted all retries to the DLQ and persist DEAD_LETTER status. */
  async sendToDeadLetterQueue(job: Job, error: Error): Promise<void> {
    const idempotencyKey = (job.data?.idempotencyKey as string) ?? (job.id as string);

    await this.dlqQueue.add(
      'dead-letter',
      { originalJobId: job.id, type: job.data?.type, data: job.data?.data, idempotencyKey, error: error.message },
      { removeOnComplete: false, removeOnFail: false },
    );
    await this.notificationRepository.markDeadLettered(idempotencyKey, error.message);
    deadLettered.inc({ type: String(job.data?.type ?? 'unknown') });
    this.logger.error(
      `Job ${job.id} moved to DLQ after ${job.attemptsMade} attempts: ${error.message}`,
      `${this.constructor.name}.sendToDeadLetterQueue`,
    );
  }

  async listDeadLettered(limit = 50): Promise<Record<string, unknown>[]> {
    return this.notificationRepository.findByStatus('DEAD_LETTER', limit);
  }

  /** Replay a dead-lettered notification onto the main queue with a fresh retry budget. */
  async retryDeadLettered(idempotencyKey: string): Promise<EnqueueResult> {
    const row = await this.notificationRepository.findFullByIdempotencyKey(idempotencyKey);
    if (!row || row.status !== 'DEAD_LETTER') {
      throw new Error(`No dead-lettered notification found for idempotency key "${idempotencyKey}"`);
    }

    await this.notificationRepository.resetForRetry(idempotencyKey);

    const jobType = row.job_type as NotificationJobType;
    const job = await this.notificationQueue.add(
      'process-notification',
      { type: jobType, data: row.payload, idempotencyKey, timestamp: Date.now() },
      { ...DEFAULT_JOB_OPTIONS, jobId: `${idempotencyKey}:replay:${Date.now()}`, priority: JOB_TYPE_PRIORITY[jobType] },
    );

    this.logger.log(`Replayed dead-lettered notification ${idempotencyKey} as job ${job.id}`, `${this.constructor.name}.retryDeadLettered`);
    return { jobId: job.id as string, notificationId: row.id as string, duplicate: false };
  }

  async getJobStatus(jobId: string): Promise<Record<string, unknown>> {
    const job = await this.notificationQueue.getJob(jobId);
    if (!job) return { status: 'not_found' };
    return {
      id: job.id,
      status: await job.getState(),
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    };
  }

  async getQueueStats(): Promise<Record<string, unknown>> {
    const [notifications, dlq] = await Promise.all([this.notificationQueue.getJobCounts(), this.dlqQueue.getJobCounts()]);
    return { notifications, dlq, timestamp: new Date().toISOString() };
  }

  /**
   * Stable key when the caller supplies none:
   * - welcome-email: one per (user, email)
   * - verification-code: 5s bucket (collapses double-submits, allows deliberate resend)
   * - notification: originating business-event id + channel, else content hash in a 1-minute window
   */
  private buildIdempotencyKey(type: NotificationJobType, data: NotificationJobData): string {
    if (type === 'welcome-email') {
      const dto = data as CreateNotificationDto;
      return `welcome-email:${dto.userId}:${dto.email}`;
    }
    if (type === 'verification-code') {
      return `verification-code:${(data as { phoneNumber: string }).phoneNumber}:${Math.floor(Date.now() / 5000)}`;
    }
    const dto = data as CreateNotificationDto;
    const eventId = (dto.metadata?.originalEvent as { id?: string } | undefined)?.id;
    if (eventId) return `notification:${eventId}:${dto.channel}`;

    const fingerprint = `${dto.userId}:${dto.channel}:${dto.title ?? ''}:${dto.message ?? ''}:${Math.floor(Date.now() / 60000)}`;
    return `notification:${createHash('sha1').update(fingerprint).digest('hex')}`;
  }

  private toReserveInput(type: NotificationJobType, data: NotificationJobData, idempotencyKey: string): ReserveNotificationInput {
    const base = { idempotencyKey, maxRetries: DEFAULT_JOB_OPTIONS.attempts, jobType: type, payload: data };

    if (type === 'verification-code') {
      return {
        ...base,
        userId: SYSTEM_USER_ID,
        title: 'Verification code',
        message: `OTP requested for ${(data as { phoneNumber: string }).phoneNumber}`,
        channel: 'SMS',
        type: 'ALERT',
      };
    }
    const dto = data as CreateNotificationDto;
    if (type === 'welcome-email') {
      return { ...base, userId: dto.userId, title: dto.title ?? 'Welcome', message: dto.message ?? '', channel: 'EMAIL', type: 'SUCCESS' };
    }
    return {
      ...base,
      userId: dto.userId,
      title: dto.title ?? 'Notification',
      message: dto.message ?? '',
      channel: dto.channel,
      type: dto.type,
    };
  }
}

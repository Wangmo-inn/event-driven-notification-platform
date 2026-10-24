import { Injectable } from '@nestjs/common';
import { Prisma } from 'prisma/app/generated/prisma/client';
import { PrismaService } from './prisma.service';

export type NotificationStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'DEAD_LETTER';

export interface ReserveNotificationInput {
  userId: string;
  title: string;
  message: string;
  channel: 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP';
  type: 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS' | 'ALERT';
  idempotencyKey: string;
  maxRetries: number;
  jobType: 'notification' | 'welcome-email' | 'verification-code';
  payload: unknown;
}

export interface ReserveNotificationResult {
  id: string;
  /** true when a row for this idempotencyKey already existed (i.e. this is a duplicate) */
  alreadyExists: boolean;
  status: NotificationStatus;
}

/**
 * Durable, source-of-truth lifecycle of an async notification job in Postgres
 * (idempotency key, status, retry count, replayable payload), independent of Redis/BullMQ.
 * Uses raw SQL so the reliability columns work right after `prisma migrate deploy`.
 */
@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Atomically reserve an idempotency key (INSERT ... ON CONFLICT DO NOTHING). */
  async reserve(input: ReserveNotificationInput): Promise<ReserveNotificationResult> {
    const payloadJson = JSON.stringify(input.payload ?? {});

    const inserted = await this.prisma.$queryRaw<{ id: string; status: NotificationStatus }[]>(Prisma.sql`
      INSERT INTO "public"."notifications"
        (id, user_id, title, message, channel, type, idempotency_key, status, max_retries,
         job_type, payload, created_at, updated_at)
      VALUES
        (gen_random_uuid(), ${input.userId}::uuid, ${input.title}, ${input.message},
         ${input.channel}::"public"."NotificationChannel", ${input.type}::"public"."NotificationType",
         ${input.idempotencyKey}, 'PENDING', ${input.maxRetries},
         ${input.jobType}, ${payloadJson}::jsonb, now(), now())
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id, status::text AS status
    `);

    if (inserted.length > 0) {
      return { id: inserted[0].id, status: inserted[0].status, alreadyExists: false };
    }

    const existing = await this.prisma.$queryRaw<{ id: string; status: NotificationStatus }[]>(Prisma.sql`
      SELECT id, status::text AS status FROM "public"."notifications"
      WHERE idempotency_key = ${input.idempotencyKey} LIMIT 1
    `);

    return { id: existing[0]?.id, status: existing[0]?.status ?? 'PENDING', alreadyExists: true };
  }

  async markProcessing(idempotencyKey: string, jobId: string, retryCount: number): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "public"."notifications"
      SET status = 'PROCESSING', job_id = ${jobId}, retry_count = ${retryCount}, updated_at = now()
      WHERE idempotency_key = ${idempotencyKey}
    `);
  }

  async markSent(idempotencyKey: string, provider: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "public"."notifications"
      SET status = 'SENT', provider = ${provider}, sent_at = now(), last_error = NULL, updated_at = now()
      WHERE idempotency_key = ${idempotencyKey}
    `);
  }

  /** A single attempt failed; BullMQ will retry with backoff. */
  async markFailedAttempt(idempotencyKey: string, error: string, retryCount: number): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "public"."notifications"
      SET status = 'FAILED', last_error = ${error}, retry_count = ${retryCount}, updated_at = now()
      WHERE idempotency_key = ${idempotencyKey}
    `);
  }

  /** All retries exhausted; job routed to the DLQ. */
  async markDeadLettered(idempotencyKey: string, error: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "public"."notifications"
      SET status = 'DEAD_LETTER', last_error = ${error}, dead_lettered_at = now(), updated_at = now()
      WHERE idempotency_key = ${idempotencyKey}
    `);
  }

  async findByStatus(status: NotificationStatus, limit = 50): Promise<Record<string, unknown>[]> {
    return this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT id, user_id, title, channel, type, idempotency_key, status::text AS status, retry_count,
             max_retries, last_error, dead_lettered_at, created_at
      FROM "public"."notifications"
      WHERE status = ${status}::"public"."NotificationStatus"
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
  }

  async findFullByIdempotencyKey(idempotencyKey: string): Promise<Record<string, unknown> | null> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT id, user_id, title, message, channel, type, idempotency_key, status::text AS status,
             retry_count, max_retries, last_error, dead_lettered_at, created_at, job_type, payload
      FROM "public"."notifications"
      WHERE idempotency_key = ${idempotencyKey} LIMIT 1
    `);
    return rows[0] ?? null;
  }

  /** Cheap status lookup used by the worker's idempotency check before calling a provider. */
  async getStatus(idempotencyKey: string): Promise<NotificationStatus | null> {
    const rows = await this.prisma.$queryRaw<{ status: NotificationStatus }[]>(Prisma.sql`
      SELECT status::text AS status FROM "public"."notifications" WHERE idempotency_key = ${idempotencyKey} LIMIT 1
    `);
    return rows[0]?.status ?? null;
  }

  async resetForRetry(idempotencyKey: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "public"."notifications"
      SET status = 'PENDING', retry_count = 0, last_error = NULL, dead_lettered_at = NULL, updated_at = now()
      WHERE idempotency_key = ${idempotencyKey}
    `);
  }
}

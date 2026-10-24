-- CreateEnum
CREATE TYPE "public"."NotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DEAD_LETTER');

-- AlterTable
ALTER TABLE "public"."notifications"
  ADD COLUMN "idempotency_key" VARCHAR(255),
  ADD COLUMN "status" "public"."NotificationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "provider" VARCHAR(50),
  ADD COLUMN "job_id" VARCHAR(100),
  ADD COLUMN "job_type" VARCHAR(50),
  ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "max_retries" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "last_error" TEXT,
  ADD COLUMN "dead_lettered_at" TIMESTAMPTZ,
  ADD COLUMN "payload" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "notifications_idempotency_key_key" ON "public"."notifications"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_notification_status" ON "public"."notifications"("status");

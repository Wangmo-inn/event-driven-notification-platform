export const NOTIFICATIONS_QUEUE = 'notifications';
export const DLQ_QUEUE = 'notifications-dlq';

/** Job options shared by every notification job: 5 attempts, exponential backoff 1s,2s,4s,8s,16s. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

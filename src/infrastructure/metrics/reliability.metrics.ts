import { Counter, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Prometheus metrics for the delivery pipeline's reliability features (retries, DLQ, rate limiting,
 * circuit breaker, queue depth). A module-level registry lets the queue worker, rate limiter and
 * circuit breaker record metrics without depending on each other; it is exposed at GET /metrics.
 */
export const reliabilityRegistry = new Registry();

export const jobAttempts = new Counter({
  name: 'notification_job_attempts_total',
  help: 'Processing attempts per job type by outcome (success | failure | duplicate_skipped)',
  labelNames: ['type', 'outcome'],
  registers: [reliabilityRegistry],
});

export const jobDuration = new Histogram({
  name: 'notification_job_duration_seconds',
  help: 'Worker time spent processing a notification job attempt',
  labelNames: ['type', 'outcome'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [reliabilityRegistry],
});

export const deadLettered = new Counter({
  name: 'notification_dead_lettered_total',
  help: 'Jobs moved to the dead-letter queue after exhausting all retries',
  labelNames: ['type'],
  registers: [reliabilityRegistry],
});

export const providerRateLimited = new Counter({
  name: 'provider_rate_limit_rejections_total',
  help: 'Outbound provider calls rejected by the per-provider rate limiter',
  labelNames: ['provider'],
  registers: [reliabilityRegistry],
});

export const circuitOpened = new Counter({
  name: 'circuit_breaker_opened_total',
  help: 'Times a provider circuit breaker transitioned to OPEN',
  labelNames: ['circuit'],
  registers: [reliabilityRegistry],
});

export const queueJobs = new Gauge({
  name: 'notification_queue_jobs',
  help: 'Current number of jobs per queue and state',
  labelNames: ['queue', 'state'],
  registers: [reliabilityRegistry],
});

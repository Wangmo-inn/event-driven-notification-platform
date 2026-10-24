import { ProviderRateLimiterService, ProviderRateLimitExceededException } from './provider-rate-limiter.service';

describe('ProviderRateLimiterService', () => {
  const logger = { warn: jest.fn() } as any;
  const config = { get: (k: string, d: number) => (k === 'TWILIO_RATE_LIMIT_PER_SEC' ? 2 : d) } as any;

  const build = (counts: number[]) => {
    const redis = { incr: jest.fn(), expire: jest.fn(), get: jest.fn() } as any;
    counts.forEach(c => redis.incr.mockResolvedValueOnce(c));
    return { redis, svc: new ProviderRateLimiterService(redis, config, logger) };
  };

  it('allows calls within the per-second limit', async () => {
    const { svc } = build([1, 2]);
    await expect(svc.consume('twilio')).resolves.toBeUndefined();
    await expect(svc.consume('twilio')).resolves.toBeUndefined();
  });

  it('throws once the window budget is exceeded', async () => {
    const { svc } = build([3]);
    await expect(svc.consume('twilio')).rejects.toBeInstanceOf(ProviderRateLimitExceededException);
  });

  it('sets the TTL only on the first hit of a window', async () => {
    const { svc, redis } = build([1, 2]);
    await svc.consume('twilio');
    await svc.consume('twilio');
    expect(redis.expire).toHaveBeenCalledTimes(1);
  });

  it('keeps independent windows per provider', async () => {
    const { svc, redis } = build([1]);
    await svc.consume('sendgrid');
    expect(redis.incr.mock.calls[0][0]).toMatch(/^ratelimit:sendgrid:/);
  });
});

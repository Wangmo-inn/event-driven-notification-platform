import { NotificationProcessor } from './notification.processor';

describe('NotificationProcessor (idempotent consumer)', () => {
  const build = (status: string | null = 'PENDING') => {
    const notificationService = { send: jest.fn(), sendWelcomeEmail: jest.fn(), sendVerificationCode: jest.fn() } as any;
    const repo = {
      getStatus: jest.fn().mockResolvedValue(status),
      markProcessing: jest.fn(),
      markSent: jest.fn(),
      markFailedAttempt: jest.fn(),
    } as any;
    const queueService = { sendToDeadLetterQueue: jest.fn() } as any;
    const logger = { log: jest.fn(), error: jest.fn() } as any;
    return { p: new NotificationProcessor(notificationService, repo, queueService, logger), notificationService, repo, queueService };
  };
  const job = (over: any = {}): any => ({
    id: 'j1',
    attemptsMade: 0,
    opts: { attempts: 5 },
    data: { type: 'notification', idempotencyKey: 'k', data: { channel: 'EMAIL' } },
    ...over,
  });

  it('delivers and marks SENT on success', async () => {
    const { p, notificationService, repo } = build();
    await p.process(job());
    expect(notificationService.send).toHaveBeenCalledTimes(1);
    expect(repo.markSent).toHaveBeenCalledWith('k', 'sendgrid');
  });

  it('skips a re-delivered job whose notification is already SENT (no duplicate send)', async () => {
    const { p, notificationService, repo } = build('SENT');
    await p.process(job());
    expect(notificationService.send).not.toHaveBeenCalled();
    expect(repo.markSent).not.toHaveBeenCalled();
  });

  it('records the failed attempt and rethrows so BullMQ retries with backoff', async () => {
    const { p, notificationService, repo } = build();
    notificationService.send.mockRejectedValue(new Error('provider down'));
    await expect(p.process(job())).rejects.toThrow('provider down');
    expect(repo.markFailedAttempt).toHaveBeenCalledWith('k', 'provider down', 1);
  });

  it('only dead-letters after the final attempt', async () => {
    const { p, queueService } = build();
    await p.onFailed(job({ attemptsMade: 3 }), new Error('x'));
    expect(queueService.sendToDeadLetterQueue).not.toHaveBeenCalled();
    await p.onFailed(job({ attemptsMade: 5 }), new Error('x'));
    expect(queueService.sendToDeadLetterQueue).toHaveBeenCalledTimes(1);
  });
});

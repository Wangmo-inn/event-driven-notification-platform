import { NotificationPriorityEnum } from 'src/domain/enums/notification-priority.enum';
import { QueueService } from './queue.service';

describe('QueueService (idempotent producer)', () => {
  const dto: any = {
    userId: '123e4567-e89b-12d3-a456-426614174000',
    channel: 'EMAIL',
    type: 'INFO',
    title: 'Hi',
    message: 'hello',
    email: 'a@b.com',
  };

  const build = (alreadyExists = false) => {
    const queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) } as any;
    const dlq = { add: jest.fn() } as any;
    const repo = {
      reserve: jest.fn().mockResolvedValue({ id: 'n-1', status: 'PENDING', alreadyExists }),
      markDeadLettered: jest.fn(),
    } as any;
    const logger = { log: jest.fn(), error: jest.fn() } as any;
    return { svc: new QueueService(queue, dlq, repo, logger), queue, dlq, repo };
  };

  it('enqueues a new notification with retry/backoff options and the idempotency key as jobId', async () => {
    const { svc, queue } = build();
    const res = await svc.enqueueNotification('notification', dto, 'my-key');
    expect(res).toEqual({ jobId: 'job-1', notificationId: 'n-1', duplicate: false });
    const [, , opts] = queue.add.mock.calls[0];
    expect(opts).toMatchObject({ jobId: 'my-key', attempts: 5, backoff: { type: 'exponential', delay: 1000 } });
  });

  it('does not enqueue when the idempotency key was already reserved', async () => {
    const { svc, queue } = build(true);
    const res = await svc.enqueueNotification('notification', dto, 'my-key');
    expect(res.duplicate).toBe(true);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('derives the same key for identical payloads (so double-submits collapse)', async () => {
    const { svc, repo } = build();
    await svc.enqueueNotification('notification', dto);
    await svc.enqueueNotification('notification', { ...dto });
    expect(repo.reserve.mock.calls[0][0].idempotencyKey).toBe(repo.reserve.mock.calls[1][0].idempotencyKey);
  });

  it('derives different keys for different payloads', async () => {
    const { svc, repo } = build();
    await svc.enqueueNotification('notification', dto);
    await svc.enqueueNotification('notification', { ...dto, message: 'other' });
    expect(repo.reserve.mock.calls[0][0].idempotencyKey).not.toBe(repo.reserve.mock.calls[1][0].idempotencyKey);
  });

  it('keys business-event notifications on the originating event id and channel', async () => {
    const { svc, repo } = build();
    await svc.enqueueNotification('notification', { ...dto, metadata: { originalEvent: { id: 'evt-9' } } });
    expect(repo.reserve.mock.calls[0][0].idempotencyKey).toBe('notification:evt-9:EMAIL');
  });

  it('sends exactly one welcome email per user/email', async () => {
    const { svc, repo } = build();
    await svc.enqueueNotification('welcome-email', dto);
    expect(repo.reserve.mock.calls[0][0].idempotencyKey).toBe(`welcome-email:${dto.userId}:a@b.com`);
  });

  it('gives OTP jobs the highest priority', async () => {
    const { svc, queue } = build();
    await svc.enqueueNotification('verification-code', { phoneNumber: '+15550001111' });
    expect(queue.add.mock.calls[0][2].priority).toBe(NotificationPriorityEnum.CRITICAL);
  });

  it('routes an exhausted job to the DLQ and persists DEAD_LETTER', async () => {
    const { svc, dlq, repo } = build();
    const job: any = { id: 'job-1', attemptsMade: 5, data: { type: 'notification', idempotencyKey: 'k', data: dto } };
    await svc.sendToDeadLetterQueue(job, new Error('boom'));
    expect(dlq.add).toHaveBeenCalledWith('dead-letter', expect.objectContaining({ idempotencyKey: 'k', error: 'boom' }), expect.anything());
    expect(repo.markDeadLettered).toHaveBeenCalledWith('k', 'boom');
  });
});

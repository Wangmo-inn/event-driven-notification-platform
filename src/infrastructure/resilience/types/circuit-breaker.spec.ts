import { CircuitStateEnum } from 'src/domain/enums/circuit-state.enum';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

describe('CircuitBreaker', () => {
  const logger = { log: jest.fn() } as any;
  const options = { failureThreshold: 3, recoveryTimeout: 1000, monitorInterval: 100 };
  const fail = () => Promise.reject(new Error('provider down'));
  const ok = () => Promise.resolve('sent');

  let now: number;
  let cb: CircuitBreaker;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    cb = new CircuitBreaker('sendgrid', options, logger);
  });
  afterEach(() => jest.restoreAllMocks());

  it('passes calls through while CLOSED', async () => {
    await expect(cb.execute(ok)).resolves.toBe('sent');
    expect(cb.getState()).toBe(CircuitStateEnum.CLOSED);
  });

  it('opens after reaching the failure threshold and then rejects without calling the provider', async () => {
    for (let i = 0; i < 3; i++) await expect(cb.execute(fail)).rejects.toThrow('provider down');
    expect(cb.getState()).toBe(CircuitStateEnum.OPEN);

    const op = jest.fn(ok);
    await expect(cb.execute(op)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(op).not.toHaveBeenCalled();
  });

  it('a success resets the consecutive failure count', async () => {
    await expect(cb.execute(fail)).rejects.toThrow();
    await expect(cb.execute(fail)).rejects.toThrow();
    await cb.execute(ok);
    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.getState()).toBe(CircuitStateEnum.CLOSED);
  });

  it('moves to HALF_OPEN after the recovery timeout and closes on a successful trial call', async () => {
    for (let i = 0; i < 3; i++) await expect(cb.execute(fail)).rejects.toThrow();
    now += 1001;
    await expect(cb.execute(ok)).resolves.toBe('sent');
    expect(cb.getState()).toBe(CircuitStateEnum.CLOSED);
  });

  it('re-opens if the HALF_OPEN trial call fails', async () => {
    for (let i = 0; i < 3; i++) await expect(cb.execute(fail)).rejects.toThrow();
    now += 1001;
    await expect(cb.execute(fail)).rejects.toThrow('provider down');
    expect(cb.getState()).toBe(CircuitStateEnum.OPEN);
    await expect(cb.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError);
  });
});

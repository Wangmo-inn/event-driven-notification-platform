import { CircuitStateEnum } from 'src/domain/enums/circuit-state.enum';
import { circuitOpened } from 'src/infrastructure/metrics/reliability.metrics';
import { ILoggerService } from 'src/infrastructure/logger/interfaces/logger.service.interface';
import { CircuitBreakerOptions } from 'src/infrastructure/resilience/interfaces/circuit-breaker-opts.interface';
import { ICircuitStats } from '../interfaces/circuit-stats.interface';
import { ICircuitBreaker } from '../interfaces/circuit.interface';

/** Thrown when a call is rejected because the circuit is OPEN (provider recently failing repeatedly). */
export class CircuitOpenError extends Error {
  constructor(circuitName: string) {
    super(`Circuit "${circuitName}" is OPEN - call rejected without hitting the downstream provider`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * CLOSED -> OPEN -> HALF_OPEN -> CLOSED state machine.
 * - CLOSED: calls pass through; consecutive failures are counted.
 * - OPEN: calls are rejected immediately until `recoveryTimeout` elapses.
 * - HALF_OPEN: one trial call is allowed; success closes the circuit, failure re-opens it.
 */
export class CircuitBreaker implements ICircuitBreaker {
  private state: CircuitStateEnum = CircuitStateEnum.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;
  private totalRequests = 0;
  private halfOpenInFlight = false;

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions,
    private readonly logger: ILoggerService,
  ) {}

  async execute<T>(operation: () => T | Promise<T>): Promise<T> {
    this.totalRequests += 1;

    if (this.state === CircuitStateEnum.OPEN) {
      if (Date.now() - this.lastFailureTime < this.options.recoveryTimeout) {
        throw new CircuitOpenError(this.name);
      }
      this.state = CircuitStateEnum.HALF_OPEN;
    }

    let isTrial = false;
    if (this.state === CircuitStateEnum.HALF_OPEN) {
      if (this.halfOpenInFlight) throw new CircuitOpenError(this.name);
      this.halfOpenInFlight = true;
      isTrial = true;
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    } finally {
      if (isTrial) this.halfOpenInFlight = false;
    }
  }

  private onSuccess(): void {
    this.successCount += 1;
    if (this.state === CircuitStateEnum.HALF_OPEN) {
      this.log('Trial call succeeded - closing circuit');
      this.state = CircuitStateEnum.CLOSED;
    }
    this.failureCount = 0;
  }

  private onFailure(): void {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitStateEnum.HALF_OPEN) {
      this.log('Trial call failed - reopening circuit');
      this.state = CircuitStateEnum.OPEN;
      circuitOpened.inc({ circuit: this.name });
    } else if (this.failureCount >= this.options.failureThreshold) {
      this.log(`Failure threshold (${this.options.failureThreshold}) reached - opening circuit`);
      this.state = CircuitStateEnum.OPEN;
      circuitOpened.inc({ circuit: this.name });
    }
  }

  /**
   * Get the circuit state
   * @returns The circuit state
   */
  getState(): CircuitStateEnum {
    return this.state;
  }

  /**
   * Get the circuit statistics
   * @returns The circuit statistics
   */
  getStats(): ICircuitStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      successCount: this.successCount,
      totalRequests: this.totalRequests,
    };
  }

  /**
   * Reset the circuit
   */
  reset(): void {
    this.log(`Resetting circuit`);
    this.state = CircuitStateEnum.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.successCount = 0;
    this.totalRequests = 0;
  }

  /**
   * Get the circuit names
   * @returns The circuit names
   */
  getNames(): string[] {
    return [this.name];
  }

  private log(message: string): void {
    this.logger.log(`Circuit ${this.name} - ${message}`, 'CircuitBreaker');
  }
}

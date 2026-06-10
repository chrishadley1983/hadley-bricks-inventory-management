/**
 * Generic retry-with-backoff utility (audit item §1.7).
 *
 * Consolidates the per-client retry loops (Rebrickable, Keepa, Google Sheets,
 * Amazon SP-API clients). Generic over the operation — NOT tied to fetch — so
 * each client keeps its own error classes and response handling.
 */

import { sleep } from '@/lib/utils';

/**
 * Sentinel error for "this attempt failed but should be retried".
 * Callers that classify retryability inside the operation (e.g. on a 429
 * response) can throw this, optionally carrying the delay to wait before the
 * next attempt, and pass `isRetryable: isRetryableError` to `withRetry`.
 */
export class RetryableError extends Error {
  constructor(
    message: string,
    /** Delay before the next attempt, in ms. Read via `retryableDelay`. */
    public readonly delayMs: number = 0
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

/** `isRetryable` predicate matching `RetryableError`. */
export function isRetryableError(error: unknown): error is RetryableError {
  return error instanceof RetryableError;
}

/** Backoff for errors carrying their own delay (`RetryableError.delayMs`). */
export function retryableDelay(_attempt: number, error: unknown): number {
  return error instanceof RetryableError ? error.delayMs : 0;
}

export interface WithRetryOptions {
  /**
   * Number of retries AFTER the first attempt (total attempts = maxRetries + 1).
   * `Number.POSITIVE_INFINITY` is allowed for unbounded retry.
   */
  maxRetries: number;
  /** Base delay for the built-in backoff strategies (default 1000). */
  baseDelayMs?: number;
  /**
   * Delay strategy between attempts (default 'exponential'):
   * - 'exponential': baseDelayMs * 2^attempt
   * - 'linear': baseDelayMs * (attempt + 1)
   * - function: custom delay in ms from (attempt, error). Return <= 0 to skip
   *   sleeping (e.g. when the operation already waited before throwing).
   */
  backoff?: 'exponential' | 'linear' | ((attempt: number, error: unknown) => number);
  /**
   * Whether a given error should be retried. Defaults to retrying every error.
   * Non-retryable errors are rethrown immediately.
   */
  isRetryable?: (error: unknown) => boolean;
  /** Called before sleeping, once per retry (not on the final throw). */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

/**
 * Run `fn` with retries. `fn` receives the zero-based attempt number.
 *
 * On failure: if the error is not retryable, or the final attempt failed,
 * the error is rethrown as-is. Otherwise the delay is computed, `onRetry`
 * fires, we sleep (when delay > 0), and the next attempt runs.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: WithRetryOptions
): Promise<T> {
  const { maxRetries, baseDelayMs = 1000, backoff = 'exponential', isRetryable, onRetry } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= maxRetries || (isRetryable && !isRetryable(error))) {
        throw error;
      }

      const delayMs =
        typeof backoff === 'function'
          ? backoff(attempt, error)
          : backoff === 'linear'
            ? baseDelayMs * (attempt + 1)
            : baseDelayMs * Math.pow(2, attempt);

      onRetry?.(attempt, error, delayMs);

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  // Unreachable: the final attempt either returns or rethrows above.
  throw new Error('withRetry: retries exhausted');
}

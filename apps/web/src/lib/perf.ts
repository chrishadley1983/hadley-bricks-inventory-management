/**
 * Lightweight performance logging utility.
 *
 * - Uses performance.now() for high-resolution timing
 * - Only logs in development or when PERF_LOG=true
 * - Zero-cost in production (functions become no-ops)
 * - Writes to files for analysis (server-side only)
 *
 * Log files:
 * - Server: logs/perf-server.jsonl (append-only, one JSON object per line)
 * - Client: Uses /api/perf endpoint to write to logs/perf-client.jsonl
 */

// Check if we're in browser or server
const isBrowser = typeof window !== 'undefined';
const isEnabled =
  process.env.NODE_ENV === 'development' ||
  process.env.PERF_LOG === 'true' ||
  (isBrowser && typeof localStorage !== 'undefined' && localStorage.getItem('PERF_LOG') === 'true');

/**
 * Performance log entry structure
 */
export interface PerfLogEntry {
  timestamp: string;
  scope: string;
  label: string;
  durationMs: number;
  context?: Record<string, number | string>;
  type: 'start' | 'log' | 'end';
  source: 'server' | 'client';
}

// Server-side file writing (lazy-loaded to avoid issues in browser)
let writeToFile: ((entry: PerfLogEntry) => void) | null = null;

async function initFileWriter(): Promise<void> {
  if (isBrowser || writeToFile !== null) return;

  try {
    const fs = await import('fs');
    const path = await import('path');

    const logsDir = path.join(process.cwd(), 'logs');

    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const serverLogPath = path.join(logsDir, 'perf-server.jsonl');

    writeToFile = (entry: PerfLogEntry) => {
      try {
        fs.appendFileSync(serverLogPath, JSON.stringify(entry) + '\n');
      } catch {
        // Silently fail - don't let perf logging break the app
      }
    };
  } catch {
    // Module not available (edge runtime, etc)
    writeToFile = () => {};
  }
}

// Initialize file writer on first use (server-side only)
if (!isBrowser) {
  initFileWriter();
}

/**
 * Write a perf entry to file (server) or queue for API (client)
 */
function writePerfEntry(entry: PerfLogEntry): void {
  // Console log as before
  const contextStr = entry.context
    ? ' ' +
      Object.entries(entry.context)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
    : '';

  if (entry.type === 'end') {
    console.log(`[PERF] [${entry.scope}] TOTAL: ${entry.durationMs.toFixed(1)}ms`);
  } else if (entry.type === 'log') {
    console.log(
      `[PERF] [${entry.scope}] ${entry.label} @${entry.durationMs.toFixed(0)}ms${contextStr}`
    );
  } else {
    console.log(`[PERF] [${entry.scope}] ${entry.label}: ${entry.durationMs.toFixed(1)}ms`);
  }

  // Write to file (server-side only for now)
  if (!isBrowser && writeToFile) {
    writeToFile(entry);
  } else if (isBrowser) {
    // Queue client entries for batch sending
    queueClientEntry(entry);
  }
}

// Client-side batching
let clientEntryQueue: PerfLogEntry[] = [];
let flushTimeout: ReturnType<typeof setTimeout> | null = null;

function queueClientEntry(entry: PerfLogEntry): void {
  clientEntryQueue.push(entry);

  // Batch send every 5 seconds or when queue hits 50 entries
  if (clientEntryQueue.length >= 50) {
    flushClientEntries();
  } else if (!flushTimeout) {
    flushTimeout = setTimeout(flushClientEntries, 5000);
  }
}

function flushClientEntries(): void {
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }

  if (clientEntryQueue.length === 0) return;

  const entries = clientEntryQueue;
  clientEntryQueue = [];

  // Send to API endpoint (fire and forget)
  fetch('/api/perf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  }).catch(() => {
    // Silently fail - don't let perf logging break the app
  });
}

/**
 * Start a performance measurement
 * Returns a function to call when the operation completes
 */
export function perf(label: string): () => void {
  if (!isEnabled) return () => {};

  const start = performance.now();
  return () => {
    const duration = performance.now() - start;
    console.log(`[PERF] ${label}: ${duration.toFixed(1)}ms`);
  };
}

/**
 * Wrap an async function with performance logging
 */
export async function perfAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!isEnabled) return fn();

  const start = performance.now();
  try {
    const result = await fn();
    const duration = performance.now() - start;
    console.log(`[PERF] ${label}: ${duration.toFixed(1)}ms`);
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    console.log(`[PERF] ${label}: ${duration.toFixed(1)}ms (FAILED)`);
    throw error;
  }
}

/**
 * Log performance with additional context (e.g., row count)
 */
export function perfLog(
  label: string,
  durationMs: number,
  context?: Record<string, number | string>
): void {
  if (!isEnabled) return;

  const contextStr = context
    ? ' ' +
      Object.entries(context)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
    : '';
  console.log(`[PERF] ${label}: ${durationMs.toFixed(1)}ms${contextStr}`);
}

/**
 * Performance logger interface
 */
export interface PerfLogger {
  start: (label: string) => () => void;
  log: (label: string, context?: Record<string, number | string>) => void;
  async: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
  end: () => void;
}

/**
 * Create a scoped performance logger for a request/operation
 */
export function createPerfLogger(scope: string): PerfLogger {
  if (!isEnabled) {
    return {
      start: () => () => {},
      log: () => {},
      async: <T>(_label: string, fn: () => Promise<T>) => fn(),
      end: () => {},
    };
  }

  const scopeStart = performance.now();
  const source = isBrowser ? 'client' : 'server';

  return {
    /** Start timing an operation, returns end function */
    start(label: string): () => void {
      const start = performance.now();
      return () => {
        const duration = performance.now() - start;
        writePerfEntry({
          timestamp: new Date().toISOString(),
          scope,
          label,
          durationMs: duration,
          type: 'start',
          source,
        });
      };
    },

    /** Log with context */
    log(label: string, context?: Record<string, number | string>): void {
      const elapsed = performance.now() - scopeStart;
      writePerfEntry({
        timestamp: new Date().toISOString(),
        scope,
        label,
        durationMs: elapsed,
        context,
        type: 'log',
        source,
      });
    },

    /** Wrap async operation */
    async async<T>(label: string, fn: () => Promise<T>): Promise<T> {
      const start = performance.now();
      try {
        const result = await fn();
        const duration = performance.now() - start;
        writePerfEntry({
          timestamp: new Date().toISOString(),
          scope,
          label,
          durationMs: duration,
          type: 'start',
          source,
        });
        return result;
      } catch (error) {
        const duration = performance.now() - start;
        writePerfEntry({
          timestamp: new Date().toISOString(),
          scope,
          label: `${label} (FAILED)`,
          durationMs: duration,
          type: 'start',
          source,
        });
        throw error;
      }
    },

    /** Log total scope duration */
    end(): void {
      const total = performance.now() - scopeStart;
      writePerfEntry({
        timestamp: new Date().toISOString(),
        scope,
        label: 'TOTAL',
        durationMs: total,
        type: 'end',
        source,
      });
    },
  };
}

/**
 * Check if perf logging is enabled (for conditional logic)
 */
export function isPerfEnabled(): boolean {
  return isEnabled;
}

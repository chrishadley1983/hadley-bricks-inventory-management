'use client';

import { useEffect, useRef } from 'react';
import type { PerfLogEntry } from '@/lib/perf';

/**
 * Check if perf logging is enabled
 */
function isPerfEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    process.env.NODE_ENV === 'development' ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('PERF_LOG') === 'true')
  );
}

// Client-side entry queue for batching
let entryQueue: PerfLogEntry[] = [];
let flushTimeout: ReturnType<typeof setTimeout> | null = null;

function queueEntry(entry: PerfLogEntry): void {
  entryQueue.push(entry);

  // Batch send every 5 seconds or when queue hits 50 entries
  if (entryQueue.length >= 50) {
    flushEntries();
  } else if (!flushTimeout) {
    flushTimeout = setTimeout(flushEntries, 5000);
  }
}

function flushEntries(): void {
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }

  if (entryQueue.length === 0) return;

  const entries = entryQueue;
  entryQueue = [];

  // Send to API endpoint (fire and forget)
  fetch('/api/perf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  }).catch(() => {
    // Silently fail
  });
}

/**
 * Log a client-side perf entry (console + queue for file)
 */
function logPerfEntry(
  scope: string,
  label: string,
  durationMs: number,
  type: 'start' | 'log' | 'end',
  context?: Record<string, number | string>
): void {
  // Console log
  const contextStr = context
    ? ' ' +
      Object.entries(context)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
    : '';

  if (type === 'end') {
    console.log(`[PERF] [${scope}] TOTAL: ${durationMs.toFixed(1)}ms`);
  } else if (type === 'log') {
    console.log(`[PERF] [${scope}] ${label} @${durationMs.toFixed(0)}ms${contextStr}`);
  } else {
    console.log(`[PERF] [${scope}] ${label}: ${durationMs.toFixed(1)}ms${contextStr}`);
  }

  // Queue for file writing
  queueEntry({
    timestamp: new Date().toISOString(),
    scope,
    label,
    durationMs,
    context,
    type,
    source: 'client',
  });
}

/**
 * Hook to log component mount/render performance
 *
 * Usage:
 *   usePerf('InventoryTable');
 *
 * Logs:
 *   [PERF] [InventoryTable] render
 *   [PERF] [InventoryTable] mounted: 150ms
 *   [PERF] [InventoryTable] data ready: 850ms (when isLoading becomes false)
 */
export function usePerf(componentName: string, isLoading?: boolean): void {
  const mountStart = useRef<number>(0);
  const hasLoggedMount = useRef(false);
  const hasLoggedDataReady = useRef(false);

  // Log render (only first render)
  if (!mountStart.current && isPerfEnabled()) {
    mountStart.current = performance.now();
    logPerfEntry(componentName, 'render', 0, 'log');
  }

  // Log mount timing
  useEffect(() => {
    if (!isPerfEnabled() || hasLoggedMount.current) return;
    hasLoggedMount.current = true;

    const duration = performance.now() - mountStart.current;
    logPerfEntry(componentName, 'mounted', duration, 'start');
  }, [componentName]);

  // Log when data becomes ready (isLoading transitions to false)
  useEffect(() => {
    if (!isPerfEnabled()) return;
    if (isLoading === false && !hasLoggedDataReady.current) {
      hasLoggedDataReady.current = true;
      const duration = performance.now() - mountStart.current;
      logPerfEntry(componentName, 'data ready', duration, 'end');
    }
  }, [componentName, isLoading]);
}

/**
 * Hook to log page navigation performance
 *
 * Usage:
 *   usePerfPage('InventoryPage');
 *
 * Logs timing from when this page component starts rendering to when it mounts.
 * For SPA navigation, this captures the actual time to render the page.
 */
export function usePerfPage(pageName: string): void {
  // Capture start time immediately when the hook is first called (during render)
  const renderStart = useRef<number>(0);
  const hasLogged = useRef(false);

  // Capture render start on first call
  if (!renderStart.current && isPerfEnabled()) {
    renderStart.current = performance.now();
    logPerfEntry(pageName, 'render start', 0, 'log');
  }

  useEffect(() => {
    if (!isPerfEnabled() || hasLogged.current) return;
    hasLogged.current = true;

    // Calculate time from render start to mount complete
    const mountTime = performance.now() - renderStart.current;
    logPerfEntry(pageName, 'page ready', mountTime, 'end');
  }, [pageName]);
}

/**
 * Hook to track async data fetching performance
 *
 * Usage:
 *   usePerfQuery('inventory-list', isLoading, data?.length);
 */
export function usePerfQuery(queryName: string, isLoading: boolean, resultCount?: number): void {
  const startTime = useRef<number>(0);
  const hasLoggedStart = useRef(false);
  const hasLoggedEnd = useRef(false);

  // Log query start
  useEffect(() => {
    if (!isPerfEnabled()) return;
    if (isLoading && !hasLoggedStart.current) {
      hasLoggedStart.current = true;
      startTime.current = performance.now();
      logPerfEntry(`Query:${queryName}`, 'started', 0, 'log');
    }
  }, [queryName, isLoading]);

  // Log query end
  useEffect(() => {
    if (!isPerfEnabled()) return;
    if (!isLoading && hasLoggedStart.current && !hasLoggedEnd.current) {
      hasLoggedEnd.current = true;
      const duration = performance.now() - startTime.current;
      const context = resultCount !== undefined ? { rows: resultCount } : undefined;
      logPerfEntry(`Query:${queryName}`, 'completed', duration, 'end', context);
    }
  }, [queryName, isLoading, resultCount]);
}

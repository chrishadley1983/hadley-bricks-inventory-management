'use client';

import { ErrorFallback } from '@/components/ErrorBoundary';

/**
 * Global error boundary for the application
 * Catches errors in route segments and displays fallback UI
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} />;
}

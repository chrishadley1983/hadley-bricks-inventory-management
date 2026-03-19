'use client';

import Link from 'next/link';
import { useActiveSession, useScannerPieces } from '@/hooks/use-scanner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LiveStatsBar } from './LiveStatsBar';
import { LivePieceFeed } from './LivePieceFeed';

const TERMINAL_STATUSES = new Set(['completed', 'aborted']);

export function LiveScannerDashboard() {
  const {
    data: session,
    isLoading: sessionLoading,
  } = useActiveSession();

  const isTerminal = session ? TERMINAL_STATUSES.has(session.status) : false;

  // Poll pieces only when there is an active (non-terminal) session
  const {
    data: piecesResponse,
  } = useScannerPieces(
    session?.id ?? null,
    undefined,
    { pageSize: 20 }
  );

  // Decide refetch behaviour: stop when session is terminal
  // (useScannerPieces uses staleTime=30s by default; we override via the inline query below)
  // For terminal sessions we just keep the last snapshot — no further polling needed.

  if (sessionLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // ── Terminal session banner ──────────────────────────────────────────────
  if (session && isTerminal) {
    const isCompleted = session.status === 'completed';
    const summary = session.summary_json;

    return (
      <div className="space-y-4">
        <div
          className={`rounded-lg border p-4 ${
            isCompleted
              ? 'border-green-300 bg-green-50 text-green-900 dark:border-green-700 dark:bg-green-950 dark:text-green-100'
              : 'border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100'
          }`}
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-lg">
                {isCompleted ? 'Scan complete' : 'Scan aborted'}
              </p>
              {summary && (
                <p className="text-sm opacity-80">
                  {summary.total_pieces} pieces &middot; {summary.accepted_count} accepted &middot;{' '}
                  {summary.flagged_count} flagged &middot; {summary.error_count} errors
                </p>
              )}
            </div>
            <Button asChild variant={isCompleted ? 'default' : 'destructive'} size="sm">
              <Link href={`/scanner/${session.id}`}>View Full Session</Link>
            </Button>
          </div>
        </div>

        {/* Show last captured pieces beneath the banner */}
        {piecesResponse && piecesResponse.data.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">Last pieces captured</h3>
            <LivePieceFeed pieces={piecesResponse.data} />
          </div>
        )}
      </div>
    );
  }

  // ── No active session ────────────────────────────────────────────────────
  if (!session) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-muted-foreground">
            No active scan — start one from the CLI
          </p>
          <code className="rounded bg-muted px-3 py-1.5 font-mono text-sm text-foreground">
            python main.py
          </code>
        </CardContent>
      </Card>
    );
  }

  // ── Active session ───────────────────────────────────────────────────────
  const pieces = piecesResponse?.data ?? [];

  return (
    <div className="space-y-4">
      <LiveStatsBar session={session} />

      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">
          Recent pieces (newest first)
        </h3>
        <LivePieceFeed pieces={pieces} />
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ScannerStatusBadge } from './ScannerStatusBadge';
import type { ScannerSession } from '@/types/scanner';

interface LiveStatsBarProps {
  session: ScannerSession;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
  }
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function LiveStatsBar({ session }: LiveStatsBarProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  useEffect(() => {
    const startMs = new Date(session.started_at).getTime();

    const tick = () => {
      const nowMs = Date.now();
      setElapsedSeconds(Math.floor((nowMs - startMs) / 1000));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [session.started_at]);

  const summary = session.summary_json;
  const totalPieces = summary?.total_pieces ?? 0;
  const acceptedCount = summary?.accepted_count ?? 0;
  const flaggedCount = summary?.flagged_count ?? 0;
  const errorCount = summary?.error_count ?? 0;
  const throughput = summary?.pieces_per_minute ?? 0;

  const isPaused = session.status === 'paused';

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-6 p-4">
        {/* Status */}
        <div className="flex items-center gap-2">
          {isPaused && (
            <span className="animate-pulse h-2 w-2 rounded-full bg-yellow-400" aria-hidden="true" />
          )}
          <ScannerStatusBadge status={session.status} />
        </div>

        {/* Duration */}
        <Stat label="Duration" value={formatDuration(elapsedSeconds)} />

        {/* Piece counts */}
        <Stat label="Total" value={String(totalPieces)} />
        <Stat label="Accepted" value={String(acceptedCount)} valueClass="text-green-600" />
        <Stat label="Flagged" value={String(flaggedCount)} valueClass="text-yellow-600" />
        <Stat label="Errors" value={String(errorCount)} valueClass="text-red-600" />

        {/* Throughput */}
        <Stat label="Throughput" value={`${throughput.toFixed(1)}/min`} />
      </CardContent>
    </Card>
  );
}

interface StatProps {
  label: string;
  value: string;
  valueClass?: string;
}

function Stat({ label, value, valueClass }: StatProps) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${valueClass ?? ''}`}>{value}</span>
    </div>
  );
}

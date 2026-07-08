import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Database, Gauge, History, AlertTriangle, Radar } from 'lucide-react';
import type { HealthSummary } from './types';

function pct(n: number | null): string {
  return n == null ? '—' : `${n.toFixed(0)}%`;
}

export function HealthCards({ health }: { health: HealthSummary }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5" />
            L1 tuples
          </CardDescription>
          <CardTitle className="text-2xl">{health.l1TuplesTotal.toLocaleString()}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">worldwide summary cache rows</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-1.5">
            <Gauge className="h-3.5 w-3.5" />
            Active tier freshness
          </CardDescription>
          <CardTitle className="text-2xl">{pct(health.activeFreshPct)}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {health.activeTierTotal.toLocaleString()} active tuples inside the 28d cycle
          </p>
        </CardContent>
      </Card>

      <Card className={health.activePastDueCount > 0 ? 'border-amber-200 dark:border-amber-900' : undefined}>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Past-due
          </CardDescription>
          <CardTitle className="text-2xl text-amber-600 dark:text-amber-400">
            {health.activePastDueCount.toLocaleString()}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">active tuples overdue for refresh</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" />
            Snapshots
          </CardDescription>
          <CardTitle className="text-2xl">{health.snapshotsCount.toLocaleString()}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">L2 monthly-delta rows written</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-1.5">
            <Radar className="h-3.5 w-3.5" />
            Last refresh
          </CardDescription>
          <CardTitle className="text-2xl">
            {health.lastTelemetryRunDate ? (
              <span>
                <span className="text-green-600 dark:text-green-400">{health.lastTelemetryOk}</span>
                {' / '}
                <span className={health.lastTelemetryFailed > 0 ? 'text-red-600 dark:text-red-400' : ''}>
                  {health.lastTelemetryFailed}
                </span>
              </span>
            ) : (
              '—'
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {health.lastTelemetryRunDate ? `ok / failed on ${health.lastTelemetryRunDate}` : 'no telemetry yet'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

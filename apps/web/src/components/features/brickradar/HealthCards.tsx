import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Database, Gauge, History, AlertTriangle, Radar, Activity } from 'lucide-react';
import { Sparkline } from './Sparkline';
import { STATUS_TEXT } from './chart-colors';
import type { HealthSummary } from './types';

function pct(n: number | null): string {
  return n == null ? '—' : `${n.toFixed(0)}%`;
}

/**
 * Section 1 — visual health strip. Hero-number tiles (dataviz marks spec) with a
 * 7-day sparkline where the underlying metric actually has daily history
 * (telemetry does; queue tier counts and the L1 total are point-in-time reads
 * with no daily snapshot table, so those stay hero-only rather than faking a
 * trend from data that doesn't exist).
 */
export function HealthCards({ health }: { health: HealthSummary }) {
  const sparkData = health.last7dTelemetry.map((d) => ({
    label: d.runDate,
    ok: d.ok,
    failed: d.failed,
    requests: d.requests,
  }));
  const requests7d = health.last7dTelemetry.reduce((s, d) => s + d.requests, 0);
  const avgPerDay = health.last7dTelemetry.length > 0 ? Math.round(requests7d / health.last7dTelemetry.length) : 0;

  const freshnessTone: 'good' | 'warn' | 'serious' =
    health.activeFreshPct == null ? 'good' : health.activeFreshPct >= 90 ? 'good' : health.activeFreshPct >= 70 ? 'warn' : 'serious';

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5" />
            L1 tuples
          </CardDescription>
          <CardTitle className="text-2xl tabular-nums">{health.l1TuplesTotal.toLocaleString()}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">worldwide summary-cache rows</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-1.5">
            <Gauge className="h-3.5 w-3.5" />
            Active-tier freshness
          </CardDescription>
          <CardTitle className={`text-2xl tabular-nums ${STATUS_TEXT[freshnessTone]}`}>{pct(health.activeFreshPct)}</CardTitle>
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
          <CardTitle className={`text-2xl tabular-nums ${STATUS_TEXT[health.activePastDueCount > 0 ? 'warn' : 'good']}`}>
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
          <CardTitle className="text-2xl tabular-nums">{health.snapshotsCount.toLocaleString()}</CardTitle>
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
          <CardTitle className="text-2xl tabular-nums">
            {health.lastTelemetryRunDate ? (
              <span>
                <span className={STATUS_TEXT.good}>{health.lastTelemetryOk}</span>
                {' / '}
                <span className={health.lastTelemetryFailed > 0 ? STATUS_TEXT.serious : ''}>
                  {health.lastTelemetryFailed}
                </span>
              </span>
            ) : (
              '—'
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {health.lastTelemetryRunDate ? `ok / failed on ${health.lastTelemetryRunDate}` : 'no telemetry yet'}
          </p>
          {sparkData.length >= 2 && (
            <Sparkline
              data={sparkData}
              series={[
                { key: 'ok', color: 'var(--status-good)', label: 'OK' },
                { key: 'failed', color: 'var(--status-serious)', label: 'Failed' },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Acquisition (7d)
          </CardDescription>
          <CardTitle className="text-2xl tabular-nums">{requests7d.toLocaleString()}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{avgPerDay.toLocaleString()} requests/night avg, catalogPG lane</p>
          {sparkData.length >= 2 && (
            <Sparkline data={sparkData} series={[{ key: 'requests', color: 'var(--lane-catalogpg)', label: 'Requests' }]} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

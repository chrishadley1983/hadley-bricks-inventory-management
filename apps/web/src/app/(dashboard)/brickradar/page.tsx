import { redirect } from 'next/navigation';
import { Radar } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import {
  HealthCards,
  LaneTelemetryTable,
  ScreenTable,
  TrendMovers,
  RecentScans,
  type HealthSummary,
  type LaneTelemetryDayRow,
  type ScreenRow,
  type TrendMoverRow,
  type ScanReportRow,
} from '@/components/features/brickradar';

// Server-rendered on every request — health/telemetry/screens are all read live off
// Supabase; there is no client-side polling or new Vercel workload here (spec
// docs/features/pg-market-intelligence/spec.md §5, P2 "coverage dividend" screens).
export const dynamic = 'force-dynamic';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface RawTelemetryRow {
  lane: string;
  run_date: string;
  requests: number | null;
  ok: number | null;
  failed: number | null;
  first_block_at_request: number | null;
}

function aggregateTelemetry(rows: RawTelemetryRow[]): LaneTelemetryDayRow[] {
  const byKey = new Map<string, LaneTelemetryDayRow>();
  for (const row of rows) {
    const key = `${row.lane}::${row.run_date}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = { lane: row.lane, runDate: row.run_date, requests: 0, ok: 0, failed: 0, firstBlockAtRequest: null };
      byKey.set(key, agg);
    }
    agg.requests += row.requests ?? 0;
    agg.ok += row.ok ?? 0;
    agg.failed += row.failed ?? 0;
    if (row.first_block_at_request != null) {
      agg.firstBlockAtRequest =
        agg.firstBlockAtRequest == null
          ? row.first_block_at_request
          : Math.min(agg.firstBlockAtRequest, row.first_block_at_request);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.runDate.localeCompare(a.runDate) || a.lane.localeCompare(b.lane)
  );
}

export default async function BrickRadarPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString().slice(0, 10);

  const [
    l1TotalRes,
    activeTotalRes,
    activePastDueRes,
    snapshotsTotalRes,
    telemetryRes,
    highStrRes,
    figRadarRes,
    trendRisersRes,
    trendFallersRes,
    recentScansRes,
  ] = await Promise.all([
    supabase.from('bricklink_pg_summary_cache').select('*', { count: 'exact', head: true }),
    supabase.from('bl_pg_refresh_queue').select('*', { count: 'exact', head: true }).eq('tier', 'active'),
    supabase
      .from('bl_pg_refresh_queue')
      .select('*', { count: 'exact', head: true })
      .eq('tier', 'active')
      .lt('next_due_at', new Date().toISOString()),
    supabase.from('bricklink_pg_snapshots').select('*', { count: 'exact', head: true }),
    supabase
      .from('bl_pg_lane_telemetry')
      .select('lane, run_date, requests, ok, failed, first_block_at_request')
      .gte('run_date', sevenDaysAgo)
      .order('run_date', { ascending: false }),
    supabase.from('pg_screen_high_str').select('*').order('sold_value_gbp', { ascending: false }).limit(50),
    supabase.from('pg_screen_fig_radar').select('*').order('sold_value_gbp', { ascending: false }).limit(50),
    supabase
      .from('pg_screen_trend_movers')
      .select('*')
      .order('used_qty_delta', { ascending: false, nullsFirst: false })
      .limit(15),
    supabase
      .from('pg_screen_trend_movers')
      .select('*')
      .order('used_qty_delta', { ascending: true, nullsFirst: false })
      .limit(15),
    // bl_pg_scan_reports: added in supabase/migrations/20260708200000_pg_scan_reports.sql,
    // not yet in the generated Database types (migration pushed separately) — cast, same
    // convention as apps/web/scripts/store-quality.ts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not yet in generated Database types
    (supabase as any)
      .from('bl_pg_scan_reports')
      .select('*')
      .order('scanned_at', { ascending: false })
      .limit(10),
  ]);

  const telemetryRows = (telemetryRes.data ?? []) as RawTelemetryRow[];
  const laneTelemetry = aggregateTelemetry(telemetryRows);

  const runDatesDesc = [...new Set(telemetryRows.map((r) => r.run_date))].sort().reverse();
  const lastTelemetryRunDate = runDatesDesc[0] ?? null;
  const lastNightRows = telemetryRows.filter((r) => r.run_date === lastTelemetryRunDate);

  const activeTierTotal = activeTotalRes.count ?? 0;
  const activePastDueCount = activePastDueRes.count ?? 0;

  const health: HealthSummary = {
    l1TuplesTotal: l1TotalRes.count ?? 0,
    activeTierTotal,
    activeFreshPct: activeTierTotal > 0 ? ((activeTierTotal - activePastDueCount) / activeTierTotal) * 100 : null,
    activePastDueCount,
    snapshotsCount: snapshotsTotalRes.count ?? 0,
    lastTelemetryRunDate,
    lastTelemetryOk: lastNightRows.reduce((s, r) => s + (r.ok ?? 0), 0),
    lastTelemetryFailed: lastNightRows.reduce((s, r) => s + (r.failed ?? 0), 0),
  };

  const highStrRows = (highStrRes.data ?? []) as ScreenRow[];
  const figRadarRows = (figRadarRes.data ?? []) as ScreenRow[];
  // Movers are ranked by used_qty_delta; a "riser" needs a positive delta and a "faller"
  // a negative one — the raw desc/asc-limited queries can otherwise both surface the same
  // flat (delta=0) tail when there's little real movement yet.
  const trendRisers = ((trendRisersRes.data ?? []) as TrendMoverRow[]).filter((r) => (r.used_qty_delta ?? 0) > 0);
  const trendFallers = ((trendFallersRes.data ?? []) as TrendMoverRow[]).filter((r) => (r.used_qty_delta ?? 0) < 0);
  const recentScans = (recentScansRes.data ?? []) as ScanReportRow[];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Radar className="h-6 w-6 text-primary" />
          BrickRadar
        </h1>
        <p className="text-muted-foreground">
          BrickLink market-intelligence coverage, refresh health, and sourcing screens (spec:
          docs/features/pg-market-intelligence/spec.md §5).
        </p>
      </div>

      <HealthCards health={health} />

      <LaneTelemetryTable rows={laneTelemetry} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ScreenTable
          title="High-STR screen"
          description="L1 parts with STR ≥ 0.5 (either condition) and GBP sold value ≥ £20 — buy-target candidates for part sourcing."
          rows={highStrRows}
        />
        <ScreenTable
          title="Fig radar"
          description="Same STR/value gate over L1 minifigs, plus new/used spread — a positive fig-arbitrage signal."
          rows={figRadarRows}
          showSpread
        />
      </div>

      <TrendMovers risers={trendRisers} fallers={trendFallers} />

      <RecentScans scans={recentScans} />
    </div>
  );
}

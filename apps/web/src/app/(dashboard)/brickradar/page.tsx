import { redirect } from 'next/navigation';
import { Radar } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import {
  HealthCards,
  LaneTelemetryTable,
  QueueFreshness,
  ScreenTable,
  TrendMovers,
  RecentScans,
  ReportsSection,
  TupleSearchCard,
  GlossaryDialog,
  CHART_VARS_CLASSNAME,
  type HealthSummary,
  type LaneTelemetryDayRow,
  type ScreenRow,
  type TrendMoverRow,
  type ScanReportRow,
  type ReportRow,
  type QueueTierSummary,
  type NextDueBucket,
} from '@/components/features/brickradar';
import type { SupabaseClient } from '@supabase/supabase-js';

// Server-rendered on every request — health/telemetry/screens are all read live off
// Supabase; there is no client-side polling or new Vercel workload here (spec
// docs/features/pg-market-intelligence/spec.md §5, P2 "coverage dividend" screens).
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * DAY_MS;

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

/** catalogpg-only daily series, oldest-first, last N days — powers the health strip. */
function catalogpgDailySeries(rows: RawTelemetryRow[], days: number): HealthSummary['last7dTelemetry'] {
  const byDate = new Map<string, { requests: number; ok: number; failed: number }>();
  for (const r of rows) {
    if (r.lane !== 'catalogpg') continue;
    const cur = byDate.get(r.run_date) ?? { requests: 0, ok: 0, failed: 0 };
    cur.requests += r.requests ?? 0;
    cur.ok += r.ok ?? 0;
    cur.failed += r.failed ?? 0;
    byDate.set(r.run_date, cur);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-days)
    .map(([runDate, v]) => ({ runDate, ...v }));
}

interface NextDueBucketDef {
  label: string;
  fromMs: number | null;
  toMs: number | null;
  overdue?: boolean;
}

/**
 * Batch-resolve item names for a screen's rows from `bl_catalog_names` — ONE
 * `.in()` query per screen, never one call per row (that would burn a BL API
 * call per row across 200 rows; see resolveItemName's own docs). Both
 * pg_screen_high_str (parts) and pg_screen_fig_radar (minifigs) are each a
 * single item_type, so one `.eq(item_type).in(item_no)` query per screen
 * covers the whole table. Cache-only — never calls the BrickLink API; names
 * simply fill in over time as tuple drill-downs cache them.
 */
async function fetchCatalogNames(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bl_catalog_names not yet in generated Database types
  supabase: SupabaseClient<any>,
  itemType: string,
  itemNos: string[]
): Promise<Map<string, string>> {
  if (itemNos.length === 0) return new Map();
  const { data, error } = await supabase
    .from('bl_catalog_names')
    .select('item_no, name')
    .eq('item_type', itemType)
    .in('item_no', itemNos);
  if (error || !data) return new Map();
  return new Map((data as { item_no: string; name: string }[]).map((r) => [r.item_no, r.name]));
}

export default async function BrickRadarPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - FOURTEEN_DAYS_MS).toISOString().slice(0, 10);

  const bucketDefs: NextDueBucketDef[] = [
    { label: 'Past due', fromMs: null, toMs: 0, overdue: true },
    { label: '0–7d', fromMs: 0, toMs: 7 * DAY_MS },
    { label: '8–14d', fromMs: 7 * DAY_MS, toMs: 14 * DAY_MS },
    { label: '15–21d', fromMs: 14 * DAY_MS, toMs: 21 * DAY_MS },
    { label: '22–28d', fromMs: 21 * DAY_MS, toMs: 28 * DAY_MS },
    { label: '29d+', fromMs: 28 * DAY_MS, toMs: null },
  ];

  const [
    l1TotalRes,
    activeTotalRes,
    activePastDueRes,
    tailTotalRes,
    graceActiveRes,
    floorActiveRes,
    rankActiveRes,
    snapshotsTotalRes,
    telemetryRes,
    highStrRes,
    figRadarRes,
    trendRisersRes,
    trendFallersRes,
    recentScansRes,
    ownStoreAuditRes,
    digestRes,
    ...bucketRes
  ] = await Promise.all([
    supabase.from('bricklink_pg_summary_cache').select('*', { count: 'exact', head: true }),
    supabase.from('bl_pg_refresh_queue').select('*', { count: 'exact', head: true }).eq('tier', 'active'),
    supabase
      .from('bl_pg_refresh_queue')
      .select('*', { count: 'exact', head: true })
      .eq('tier', 'active')
      .lt('next_due_at', now.toISOString()),
    supabase.from('bl_pg_refresh_queue').select('*', { count: 'exact', head: true }).eq('tier', 'tail'),
    supabase
      .from('bl_pg_refresh_queue')
      .select('*', { count: 'exact', head: true })
      .eq('tier', 'active')
      .not('grace_until', 'is', null)
      .gt('grace_until', now.toISOString()),
    supabase
      .from('bl_pg_refresh_queue')
      .select('*', { count: 'exact', head: true })
      .eq('tier', 'active')
      .not('rank_floor', 'is', null),
    supabase
      .from('bl_pg_refresh_queue')
      .select('*', { count: 'exact', head: true })
      .eq('tier', 'active')
      .is('rank_floor', null)
      .or(`grace_until.is.null,grace_until.lte.${now.toISOString()}`),
    supabase.from('bricklink_pg_snapshots').select('*', { count: 'exact', head: true }),
    supabase
      .from('bl_pg_lane_telemetry')
      .select('lane, run_date, requests, ok, failed, first_block_at_request')
      .gte('run_date', fourteenDaysAgo)
      .order('run_date', { ascending: false }),
    supabase.from('pg_screen_high_str').select('*').order('sold_value_gbp', { ascending: false }).limit(200),
    supabase.from('pg_screen_fig_radar').select('*').order('sold_value_gbp', { ascending: false }).limit(200),
    supabase
      .from('pg_screen_trend_movers')
      .select('*')
      .order('used_qty_delta', { ascending: false, nullsFirst: false })
      .limit(20),
    supabase
      .from('pg_screen_trend_movers')
      .select('*')
      .order('used_qty_delta', { ascending: true, nullsFirst: false })
      .limit(20),
    // bl_pg_scan_reports / bl_pg_reports: added in migrations pushed separately —
    // not yet in the generated Database types. any-cast, same convention as
    // apps/web/scripts/store-quality.ts. Both degrade to an empty result
    // (non-fatal) if the table 404s — supabase-js resolves {error} rather than
    // throwing, so a missing relation just yields an empty section below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not yet in generated Database types
    (supabase as any).from('bl_pg_scan_reports').select('*').order('scanned_at', { ascending: false }).limit(15),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not yet in generated Database types
    (supabase as any)
      .from('bl_pg_reports')
      .select('*')
      .eq('kind', 'own_store_audit')
      .order('generated_at', { ascending: false })
      .limit(1),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not yet in generated Database types
    (supabase as any).from('bl_pg_reports').select('*').eq('kind', 'digest').order('generated_at', { ascending: false }).limit(1),
    ...bucketDefs.map((b) => {
      let q = supabase.from('bl_pg_refresh_queue').select('*', { count: 'exact', head: true }).eq('tier', 'active');
      if (b.fromMs != null) q = q.gte('next_due_at', new Date(now.getTime() + b.fromMs).toISOString());
      if (b.toMs != null) q = q.lt('next_due_at', new Date(now.getTime() + b.toMs).toISOString());
      return q;
    }),
  ]);

  const telemetryRows = (telemetryRes.data ?? []) as RawTelemetryRow[];
  const laneTelemetry = aggregateTelemetry(telemetryRows);
  const last7dTelemetry = catalogpgDailySeries(telemetryRows, 7);

  const catalogpgRows = telemetryRows.filter((r) => r.lane === 'catalogpg');
  const runDatesDesc = [...new Set(catalogpgRows.map((r) => r.run_date))].sort().reverse();
  const lastTelemetryRunDate = runDatesDesc[0] ?? null;
  const lastNightRows = catalogpgRows.filter((r) => r.run_date === lastTelemetryRunDate);

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
    last7dTelemetry,
  };

  const queueTiers: QueueTierSummary = {
    activeTotal: activeTierTotal,
    activeByRank: rankActiveRes.count ?? 0,
    activeByGrace: graceActiveRes.count ?? 0,
    activeByFloor: floorActiveRes.count ?? 0,
    tailTotal: tailTotalRes.count ?? 0,
    pastDueCount: activePastDueCount,
  };

  const nextDueBuckets: NextDueBucket[] = bucketDefs.map((b, i) => ({
    label: b.label,
    count: bucketRes[i]?.count ?? 0,
    overdue: b.overdue,
  }));

  const highStrRowsRaw = (highStrRes.data ?? []) as ScreenRow[];
  const figRadarRowsRaw = (figRadarRes.data ?? []) as ScreenRow[];

  // Batched (never per-row) name fill-in — see fetchCatalogNames above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bl_catalog_names not yet in generated Database types
  const namesSupabase = supabase as SupabaseClient<any>;
  const [highStrNames, figRadarNames] = await Promise.all([
    fetchCatalogNames(namesSupabase, 'P', [...new Set(highStrRowsRaw.map((r) => r.item_no))]),
    fetchCatalogNames(namesSupabase, 'M', [...new Set(figRadarRowsRaw.map((r) => r.item_no))]),
  ]);
  const highStrRows = highStrRowsRaw.map((r) => ({ ...r, item_name: highStrNames.get(r.item_no) ?? null }));
  const figRadarRows = figRadarRowsRaw.map((r) => ({ ...r, item_name: figRadarNames.get(r.item_no) ?? null }));
  // Movers are ranked by used_qty_delta; a "riser" needs a positive delta and a "faller"
  // a negative one — the raw desc/asc-limited queries can otherwise both surface the same
  // flat (delta=0) tail when there's little real movement yet.
  const trendRisers = ((trendRisersRes.data ?? []) as TrendMoverRow[]).filter((r) => (r.used_qty_delta ?? 0) > 0);
  const trendFallers = ((trendFallersRes.data ?? []) as TrendMoverRow[]).filter((r) => (r.used_qty_delta ?? 0) < 0);
  const recentScans = (recentScansRes.error ? [] : (recentScansRes.data ?? [])) as ScanReportRow[];
  const ownStoreAudit = (ownStoreAuditRes.error ? [] : (ownStoreAuditRes.data ?? []))[0] as ReportRow | undefined;
  const digest = (digestRes.error ? [] : (digestRes.data ?? []))[0] as ReportRow | undefined;

  return (
    <div className={`space-y-6 p-6 ${CHART_VARS_CLASSNAME}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
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
        <GlossaryDialog />
      </div>

      <HealthCards health={health} />

      <QueueFreshness tiers={queueTiers} buckets={nextDueBuckets} telemetry14d={laneTelemetry} />

      <LaneTelemetryTable rows={laneTelemetry.slice(0, 100)} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ScreenTable
          title="High-STR screen"
          description="L1 parts with STR ≥ 0.5 (either condition) and GBP sold value ≥ £20 — buy-target candidates for part sourcing."
          infoTip="L1 worldwide STR/value gate used to surface part sourcing buy-candidates — click an item number for our drill-down, or the external-link icon for BrickLink's own catalogue page."
          rows={highStrRows}
        />
        <ScreenTable
          title="Fig radar"
          description="Same STR/value gate over L1 minifigs, plus new/used spread — a positive fig-arbitrage signal."
          infoTip="Same STR/value gate applied to minifigs, with the new-vs-used price spread as an arbitrage signal."
          rows={figRadarRows}
          showSpread
        />
      </div>

      <TrendMovers risers={trendRisers} fallers={trendFallers} />

      <ReportsSection ownStoreAudit={ownStoreAudit ?? null} digest={digest ?? null} />

      <RecentScans scans={recentScans} />

      <TupleSearchCard />
    </div>
  );
}

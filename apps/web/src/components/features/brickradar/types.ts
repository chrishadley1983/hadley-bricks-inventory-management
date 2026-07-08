/**
 * BrickRadar dashboard (/brickradar) shared row shapes.
 *
 * These mirror the SQL views/tables read directly by the server-component page
 * (docs/features/pg-market-intelligence/spec.md §5) — see
 * supabase/migrations/20260708120000_pg_screens_views.sql and
 * supabase/migrations/20260708090000_pg_platform_p0.sql for the source shapes.
 */

export interface HealthSummary {
  l1TuplesTotal: number;
  activeTierTotal: number;
  activeFreshPct: number | null;
  activePastDueCount: number;
  snapshotsCount: number;
  lastTelemetryRunDate: string | null;
  lastTelemetryOk: number;
  lastTelemetryFailed: number;
}

export interface LaneTelemetryDayRow {
  lane: string;
  runDate: string;
  requests: number;
  ok: number;
  failed: number;
  /** Earliest first_block_at_request across the day's sessions, null = no block. */
  firstBlockAtRequest: number | null;
}

export interface ScreenRow {
  item_type: string;
  item_no: string;
  colour_id: number;
  str_new: number | null;
  str_used: number | null;
  sold6m_new_qty: number | null;
  sold6m_new_avg: number | null;
  sold6m_used_qty: number | null;
  sold6m_used_avg: number | null;
  stock_qty: number | null;
  sold_value_gbp: number | null;
  months_of_stock: number | null;
  /** fig radar only. */
  new_used_spread?: number | null;
}

export interface TrendMoverRow {
  item_type: string;
  item_no: string;
  colour_id: number;
  latest_date: string;
  prior_date: string;
  used_qty_delta: number | null;
  new_qty_delta: number | null;
  latest_used_qty: number | null;
  prior_used_qty: number | null;
  latest_used_avg: number | null;
  prior_used_avg: number | null;
  latest_str_used: number | null;
  latest_str_new: number | null;
}

export interface ScanReportRow {
  id: number;
  store_slug: string;
  scanned_at: string;
  verdict: string | null;
  lots_total: number | null;
  lots_passing: number | null;
  outlay_gbp: number | null;
  raw_net_gbp: number | null;
  realisable_net_gbp: number | null;
  price_source_uk: number | null;
  price_source_world: number | null;
  price_source_uncovered: number | null;
  identity_ambiguous: number | null;
  floor_unviable: number | null;
  variant_recovered: number | null;
  report_md: string;
}

/** Plain-English lane labels (task spec) — used by LaneTelemetryTable. */
export const LANE_LABELS: Record<string, string> = {
  anon_curl: 'anon_curl (anonymous curl)',
  catalogpg: 'catalogpg (browser catalogPG scrape)',
  store_api: 'store_api (official BL store API)',
  brickstore_batch: 'brickstore_batch (BrickStore harvest)',
  canary: 'canary',
};

export function laneLabel(lane: string): string {
  return LANE_LABELS[lane] ?? lane;
}

/**
 * BrickRadar dashboard (/brickradar) shared row shapes.
 *
 * These mirror the SQL views/tables read directly by the server-component page
 * (docs/features/pg-market-intelligence/spec.md §5) — see
 * supabase/migrations/20260708120000_pg_screens_views.sql,
 * supabase/migrations/20260708090000_pg_platform_p0.sql,
 * supabase/migrations/20260708200000_pg_scan_reports.sql,
 * supabase/migrations/20260708210000_pg_reports.sql,
 * supabase/migrations/20260707151000_create_bricklink_price_guide_cache.sql, and
 * supabase/migrations/20260616090152_create_bricklink_part_out_value.sql
 * for the source shapes.
 */

export interface DailySparklinePoint {
  runDate: string;
  requests: number;
  ok: number;
  failed: number;
}

export interface HealthSummary {
  l1TuplesTotal: number;
  activeTierTotal: number;
  activeFreshPct: number | null;
  activePastDueCount: number;
  snapshotsCount: number;
  lastTelemetryRunDate: string | null;
  lastTelemetryOk: number;
  lastTelemetryFailed: number;
  /** Last 7 days, oldest first — powers the health-strip sparklines. */
  last7dTelemetry: DailySparklinePoint[];
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

/** bl_pg_reports (spec §5.1) — own-store-audit / weekly-digest run history. */
export interface ReportRow {
  id: number;
  kind: 'own_store_audit' | 'digest';
  subject: string | null;
  generated_at: string;
  summary: Record<string, number | string>;
  report_md: string;
}

export interface OwnStoreAuditSummary {
  overpricedCount: number;
  underpricedCount: number;
  deadStockCount: number;
  missingRestockCount: number;
  lotsAudited: number;
}

export interface DigestSummary {
  risersCount: number;
  fallersCount: number;
  figMoversCount: number;
  l1Total: number;
  activeTierCount: number;
  activeWithin28dPct: number;
  pastDueCount: number;
}

/** bl_pg_refresh_queue tier breakdown (spec §4.1). */
export interface QueueTierSummary {
  activeTotal: number;
  activeByRank: number;
  activeByGrace: number;
  activeByFloor: number;
  tailTotal: number;
  pastDueCount: number;
}

/** Next-due distribution bucket (active tier only). */
export interface NextDueBucket {
  label: string;
  count: number;
  /** true for the single "overdue" bucket — rendered with the status-serious color. */
  overdue?: boolean;
}

/** Full L1 worldwide summary-cache row (tuple drill-down). */
export interface SummaryCacheRow {
  item_type: string;
  item_no: string;
  colour_id: number;
  currency: string;
  fx_rate: number | null;
  fetch_identity: string | null;
  sold6m_new_lots: number;
  sold6m_new_qty: number;
  sold6m_new_min: number | null;
  sold6m_new_avg: number | null;
  sold6m_new_qavg: number | null;
  sold6m_new_max: number | null;
  sold6m_used_lots: number;
  sold6m_used_qty: number;
  sold6m_used_min: number | null;
  sold6m_used_avg: number | null;
  sold6m_used_qavg: number | null;
  sold6m_used_max: number | null;
  stock_new_lots: number;
  stock_new_qty: number;
  stock_new_min: number | null;
  stock_new_avg: number | null;
  stock_new_max: number | null;
  stock_used_lots: number;
  stock_used_qty: number;
  stock_used_min: number | null;
  stock_used_avg: number | null;
  stock_used_max: number | null;
  str_new: number | null;
  str_used: number | null;
  no_data: boolean;
  fetched_at: string;
}

/** uk_detail / world_detail JSONB shape (apps/web/src/lib/bricklink/price-guide-cache.service.ts). */
export interface PgMonthBucket {
  lots: number;
  qty: number;
  avg: number;
}
export type PgHist = Record<string, number>;
export interface PgQuadrantDetail {
  min: number | null;
  max: number | null;
  byMonth?: Record<string, PgMonthBucket>;
  hist?: PgHist;
}
export interface PgDetailBlock {
  soldNew: PgQuadrantDetail;
  soldUsed: PgQuadrantDetail;
  stockNew: PgQuadrantDetail;
  stockUsed: PgQuadrantDetail;
}

/** Full L3 UK price-guide-cache row (tuple drill-down). */
export interface PriceGuideCacheRow {
  item_type: string;
  item_no: string;
  colour_id: number;
  item_name: string | null;
  uk_sold_avg_new: number | null;
  uk_sold_avg_used: number | null;
  uk_sold_qty_avg_new: number | null;
  uk_sold_qty_avg_used: number | null;
  uk_sold_median_new: number | null;
  uk_sold_median_used: number | null;
  uk_sold_lots_new: number;
  uk_sold_lots_used: number;
  uk_sold_qty_new: number;
  uk_sold_qty_used: number;
  uk_sold_last2mo_qty_new: number;
  uk_sold_last2mo_qty_used: number;
  uk_stock_qty_new: number;
  uk_stock_qty_used: number;
  uk_stock_lots_new: number;
  uk_stock_lots_used: number;
  uk_stock_min_new: number | null;
  uk_stock_min_used: number | null;
  uk_detail: PgDetailBlock | null;
  parse_version: number;
  fetched_at: string;
}

/** bricklink_part_out_value_cache row (tuple drill-down, sets only). */
export interface PovRow {
  set_number: string;
  set_name: string | null;
  condition: string;
  sold_6mo_avg_gbp: number | null;
  sold_6mo_items: number | null;
  sold_6mo_lots: number | null;
  for_sale_avg_gbp: number | null;
  for_sale_items: number | null;
  for_sale_lots: number | null;
  uk_retail_gbp: number | null;
  partout_multiple: number | null;
  fetched_at: string;
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

export function itemTypeLabel(itemType: string): string {
  if (itemType === 'P') return 'Part';
  if (itemType === 'S') return 'Set';
  if (itemType === 'M') return 'Minifig';
  return itemType;
}

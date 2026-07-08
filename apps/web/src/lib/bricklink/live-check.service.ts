/**
 * Live-check service (spec: docs/features/pg-market-intelligence/spec.md §3 F7, §2.2 lane A).
 *
 * On-demand, official UK price check for a single (item, colour) tuple at buy/analysis time,
 * via the BL store API's own price-guide endpoint (`country_code=UK`) — instant, quota-cheap,
 * and independent of the bulk lane D (catalogPG page-scrape) refresh cadence.
 *
 * Callers: bl-basket, store-scan buy candidates, set-buy-check, screens' "verify before
 * acting" links (see spec F7). This module is the shared implementation; `scripts/pg/pg-live-check.ts`
 * is the CLI wrapper.
 *
 * Budget: 2 calls/tuple by default (sold N + sold U). `opts.includeStock` adds the matching
 * stock calls (2 more) for a 4-call ceiling. All calls go through `BrickLinkClient`, which
 * enforces the shared daily budget gate and throws `RateLimitError` when our share is spent —
 * `liveCheckBatch` treats that as a clean stop, not a crash.
 *
 * Write-through is intentionally PARTIAL, not a full-row replace: `bricklink_price_guide_cache`
 * (L3) is primarily filled by lane D's catalogPG page scrape, which also carries median,
 * monthly buckets and worldwide context that the plain price-guide API does not return. A
 * live check therefore only ever writes the columns it actually fetched (sold new/used, and
 * stock new/used when requested) — columns it did not fetch are omitted from the upsert
 * payload entirely so Postgres/PostgREST leaves the existing value untouched on conflict,
 * rather than nulling out data lane D already collected.
 *
 * Known gap: `bricklink_price_guide_cache` has no per-lane provenance column (unlike L1's
 * `fetch_identity`/`fx_rate` added in the P0 migration) and `fetched_at` is a single
 * whole-row timestamp. A live check that only refreshed the sold quadrants still bumps
 * `fetched_at`, which is the deliberate F7 behaviour ("live checks... top it up at decision
 * time", spec §2.1) but means a subsequent cache-TTL check (`PriceGuideCacheService.getFresh`)
 * cannot tell that stock/median are still lane-D-stale. Flagged for a future migration
 * (per-quadrant freshness or a `fetch_identity` column on L3); out of scope for this file.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { RateLimitError, type BrickLinkClient } from './client';
import type { BrickLinkItemType, BrickLinkPriceGuide } from './types';
import { pgCacheKey, type PriceGuideCacheService } from './price-guide-cache.service';
import { normaliseSetNo, type PgItemType } from './price-guide-page';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Sentinel `parse_version` for rows whose sold/stock columns were last touched by the API
 * live-check lane rather than the catalogPG page-scrape parser (`PG_PARSE_VERSION` in
 * price-guide-cache.service.ts, currently 2). Distinguishes provenance for anyone reading the
 * column directly; no code currently branches on this value (verified: only a unit test on
 * page-scrape rows asserts an exact match against `PG_PARSE_VERSION`).
 */
export const LIVE_CHECK_PARSE_VERSION = 0;

const ITEM_TYPE_TO_API: Record<PgItemType, BrickLinkItemType> = { P: 'PART', S: 'SET', M: 'MINIFIG' };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LiveCheckTuple {
  itemType: PgItemType;
  itemNo: string;
  /** BL colour ID. Ignored (treated as 0) for sets/minifigs. */
  colourId: number;
}

export interface LiveCheckTupleOptions {
  /** Conditions to fetch for the SOLD guide. Default both — the spec's 2-calls/tuple budget. */
  conditions?: ('N' | 'U')[];
  /** Also fetch the STOCK guide for the same conditions (2 more calls). Default false. */
  includeStock?: boolean;
  /** Delay between the individual API calls within one tuple check (ms). Default 250. */
  callSpacingMs?: number;
}

/** One resolved (or failed/unfetched) price-guide call. */
export type PriceGuideFetch =
  | { requested: false }
  | { requested: true; ok: true; guide: BrickLinkPriceGuide }
  | { requested: true; ok: false; error: string };

export interface TupleFetches {
  soldNew: PriceGuideFetch;
  soldUsed: PriceGuideFetch;
  stockNew: PriceGuideFetch;
  stockUsed: PriceGuideFetch;
}

/** Partial `bricklink_price_guide_cache` upsert row — only fetched columns are present. */
export interface UkCacheFieldsRow {
  item_type: PgItemType;
  item_no: string;
  colour_id: number;
  uk_sold_avg_new?: number | null;
  uk_sold_avg_used?: number | null;
  uk_sold_qty_avg_new?: number | null;
  uk_sold_qty_avg_used?: number | null;
  uk_sold_lots_new?: number;
  uk_sold_lots_used?: number;
  uk_sold_qty_new?: number;
  uk_sold_qty_used?: number;
  uk_stock_qty_new?: number;
  uk_stock_qty_used?: number;
  uk_stock_lots_new?: number;
  uk_stock_lots_used?: number;
  uk_stock_min_new?: number | null;
  uk_stock_min_used?: number | null;
  parse_version: number;
  fetched_at: string;
  updated_at: string;
}

/** Partial `bricklink_part_price_cache` upsert row (parts + minifigs only). */
export interface PartPriceCacheFieldsRow {
  part_number: string;
  part_type: 'PART' | 'MINIFIG';
  colour_id: number;
  price_new?: number | null;
  price_used?: number | null;
  stock_available_new?: number;
  stock_available_used?: number;
  times_sold_new?: number;
  times_sold_used?: number;
  fetched_at: string;
  updated_at: string;
}

export interface ConditionSummary {
  lots: number;
  qty: number;
  avg: number | null;
  qtyAvg: number | null;
  min: number | null;
}

export interface LiveCheckTupleResult {
  tuple: LiveCheckTuple;
  fetchedAt: string;
  /** Total API calls attempted for this tuple (2-4). */
  requests: number;
  okCount: number;
  failedCount: number;
  errors: string[];
  sold: { N: ConditionSummary | null; U: ConditionSummary | null };
  stock: { N: ConditionSummary | null; U: ConditionSummary | null };
  wroteToUkCache: boolean;
  wroteToPartPriceCache: boolean;
  /** Age (days) of any prior `bricklink_price_guide_cache` row for this tuple; null = new tuple. */
  priorCacheAgeDays: number | null;
}

export interface LiveCheckBatchOptions extends LiveCheckTupleOptions {
  /** Delay between tuples in the batch (ms). Default 1100 — BL API politeness (spec §2.2 lane A). */
  spacingMs?: number;
  /** `bl_pg_lane_telemetry.lane` value. Default 'store_api'. */
  telemetryLane?: string;
  telemetrySessionNo?: number;
  /** Skip the telemetry write (unit tests). */
  skipTelemetry?: boolean;
}

export interface LiveCheckBatchResult {
  results: LiveCheckTupleResult[];
  tuplesRequested: number;
  tuplesCompleted: number;
  requestsTotal: number;
  ok: number;
  failed: number;
  /** True when a `RateLimitError` stopped the batch before all tuples were processed. */
  budgetExhausted: boolean;
  /** 1-based request count at which the budget was hit; null if not exhausted. */
  firstBlockAtRequest: number | null;
}

// ---------------------------------------------------------------------------
// Pure mapping (exported for unit testing)
// ---------------------------------------------------------------------------

function parseGuideNumber(s: string | undefined | null): number | null {
  if (s == null) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Summarise one resolved price-guide fetch. Semantics (validated against the catalogPG
 * page-scrape parity check, see price-guide-page.ts header): `unit_quantity` = lot
 * count, `total_quantity` = total pieces. A qty of 0 means the API genuinely returned no UK
 * transactions/listings for this condition in the window — that is a real "no data" result,
 * not a fetch failure, so avg/qtyAvg/min are nulled (the honoured "no UK sales" sentinel used
 * elsewhere in this codebase) rather than left at whatever zero-ish string the API sent.
 */
export function summariseGuideFetch(fetch: PriceGuideFetch): ConditionSummary | null {
  if (!fetch.requested || !fetch.ok) return null;
  const g = fetch.guide;
  const qty = g.total_quantity ?? 0;
  const lots = g.unit_quantity ?? 0;
  if (qty <= 0) {
    return { lots: 0, qty: 0, avg: null, qtyAvg: null, min: null };
  }
  return {
    lots,
    qty,
    avg: parseGuideNumber(g.avg_price),
    qtyAvg: parseGuideNumber(g.qty_avg_price),
    min: parseGuideNumber(g.min_price),
  };
}

/**
 * Map a tuple's resolved price-guide fetches into a PARTIAL `bricklink_price_guide_cache`
 * upsert row. Only conditions/guide-types that were actually requested AND succeeded appear
 * as keys on the returned object — callers must upsert this object as-is (not spread onto a
 * fully-defaulted row) so Postgres/PostgREST leaves untouched columns alone on conflict.
 */
export function apiPriceGuideToUkCacheFields(
  tuple: LiveCheckTuple,
  fetches: TupleFetches,
  fetchedAt: string = new Date().toISOString(),
): UkCacheFieldsRow {
  const soldNew = summariseGuideFetch(fetches.soldNew);
  const soldUsed = summariseGuideFetch(fetches.soldUsed);
  const stockNew = summariseGuideFetch(fetches.stockNew);
  const stockUsed = summariseGuideFetch(fetches.stockUsed);

  const row: UkCacheFieldsRow = {
    item_type: tuple.itemType,
    item_no: tuple.itemNo,
    colour_id: tuple.itemType === 'P' ? tuple.colourId : 0,
    parse_version: LIVE_CHECK_PARSE_VERSION,
    fetched_at: fetchedAt,
    updated_at: fetchedAt,
  };

  if (soldNew) {
    row.uk_sold_avg_new = soldNew.avg;
    row.uk_sold_qty_avg_new = soldNew.qtyAvg;
    row.uk_sold_lots_new = soldNew.lots;
    row.uk_sold_qty_new = soldNew.qty;
  }
  if (soldUsed) {
    row.uk_sold_avg_used = soldUsed.avg;
    row.uk_sold_qty_avg_used = soldUsed.qtyAvg;
    row.uk_sold_lots_used = soldUsed.lots;
    row.uk_sold_qty_used = soldUsed.qty;
  }
  if (stockNew) {
    row.uk_stock_qty_new = stockNew.qty;
    row.uk_stock_lots_new = stockNew.lots;
    row.uk_stock_min_new = stockNew.min;
  }
  if (stockUsed) {
    row.uk_stock_qty_used = stockUsed.qty;
    row.uk_stock_lots_used = stockUsed.lots;
    row.uk_stock_min_used = stockUsed.min;
  }

  return row;
}

/**
 * Map the same fetches into a partial `bricklink_part_price_cache` write-through row (parts
 * + minifigs only — mirrors `PriceGuideCacheService.writeThroughPartPriceCache`'s semantics:
 * price_* = UK sold avg, times_sold_* = UK sold qty, stock_available_* = UK stock qty).
 * Returns null for sets (that table has no set rows) or when nothing was fetched.
 */
export function apiPriceGuideToPartPriceCacheFields(
  tuple: LiveCheckTuple,
  fetches: TupleFetches,
  fetchedAt: string = new Date().toISOString(),
): PartPriceCacheFieldsRow | null {
  if (tuple.itemType === 'S') return null;

  const soldNew = summariseGuideFetch(fetches.soldNew);
  const soldUsed = summariseGuideFetch(fetches.soldUsed);
  const stockNew = summariseGuideFetch(fetches.stockNew);
  const stockUsed = summariseGuideFetch(fetches.stockUsed);
  if (!soldNew && !soldUsed && !stockNew && !stockUsed) return null;

  const row: PartPriceCacheFieldsRow = {
    part_number: tuple.itemNo,
    part_type: tuple.itemType === 'P' ? 'PART' : 'MINIFIG',
    colour_id: tuple.itemType === 'P' ? tuple.colourId : 0,
    fetched_at: fetchedAt,
    updated_at: fetchedAt,
  };
  if (soldNew) {
    row.price_new = soldNew.avg;
    row.times_sold_new = soldNew.qty;
  }
  if (soldUsed) {
    row.price_used = soldUsed.avg;
    row.times_sold_used = soldUsed.qty;
  }
  if (stockNew) row.stock_available_new = stockNew.qty;
  if (stockUsed) row.stock_available_used = stockUsed.qty;
  return row;
}

// ---------------------------------------------------------------------------
// Fetch + write-through
// ---------------------------------------------------------------------------

async function fetchOne(
  client: BrickLinkClient,
  tuple: LiveCheckTuple,
  apiItemNo: string,
  condition: 'N' | 'U',
  guideType: 'sold' | 'stock',
): Promise<PriceGuideFetch> {
  try {
    const guide = await client.getPartPriceGuide(ITEM_TYPE_TO_API[tuple.itemType], apiItemNo, tuple.colourId, {
      condition,
      guideType,
      countryCode: 'UK',
      currencyCode: 'GBP',
    });
    return { requested: true, ok: true, guide };
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    return { requested: true, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Live-check a single tuple: fetch the official UK sold (and optionally stock) price guide
 * from the BL store API, write through to L3 (`bricklink_price_guide_cache`) and, for
 * parts/minifigs, `bricklink_part_price_cache`.
 *
 * Throws `RateLimitError` if the client's daily budget gate trips mid-tuple — callers
 * (notably `liveCheckBatch`) must treat that as "stop issuing further requests", not a
 * per-tuple failure to retry.
 */
export async function liveCheckTuple(
  client: BrickLinkClient,
  cacheService: PriceGuideCacheService,
  supabase: SupabaseClient,
  tuple: LiveCheckTuple,
  opts: LiveCheckTupleOptions = {},
): Promise<LiveCheckTupleResult> {
  const conditions = opts.conditions ?? ['N', 'U'];
  const includeStock = opts.includeStock ?? false;
  const callSpacingMs = opts.callSpacingMs ?? 250;

  const apiItemNo = tuple.itemType === 'S' ? normaliseSetNo(tuple.itemNo) : tuple.itemNo;

  // Informational only: how stale (if at all) the existing L3 row is, so callers can report
  // "verified" vs "first time seen" without a second query of their own.
  let priorCacheAgeDays: number | null = null;
  try {
    const priorRows = await cacheService.getFresh([tuple], 36500);
    const prior = priorRows.get(pgCacheKey(tuple));
    if (prior) priorCacheAgeDays = (Date.now() - new Date(prior.fetched_at).getTime()) / 86400000;
  } catch (err) {
    console.warn(`[liveCheckTuple] prior-cache lookup failed for ${pgCacheKey(tuple)}:`, (err as Error).message);
  }

  const fetches: TupleFetches = {
    soldNew: { requested: false },
    soldUsed: { requested: false },
    stockNew: { requested: false },
    stockUsed: { requested: false },
  };
  let requests = 0;
  let first = true;
  const spaced = async () => {
    if (!first) await sleep(callSpacingMs);
    first = false;
  };

  for (const cond of conditions) {
    await spaced();
    requests++;
    const fetch = await fetchOne(client, tuple, apiItemNo, cond, 'sold');
    if (cond === 'N') fetches.soldNew = fetch;
    else fetches.soldUsed = fetch;
  }
  if (includeStock) {
    for (const cond of conditions) {
      await spaced();
      requests++;
      const fetch = await fetchOne(client, tuple, apiItemNo, cond, 'stock');
      if (cond === 'N') fetches.stockNew = fetch;
      else fetches.stockUsed = fetch;
    }
  }

  const fetchedAt = new Date().toISOString();
  const errors: string[] = [];
  let okCount = 0;
  let failedCount = 0;
  for (const f of [fetches.soldNew, fetches.soldUsed, fetches.stockNew, fetches.stockUsed]) {
    if (!f.requested) continue;
    if (f.ok) okCount++;
    else {
      failedCount++;
      errors.push(f.error);
    }
  }

  const ukRow = apiPriceGuideToUkCacheFields(tuple, fetches, fetchedAt);
  const hasUkData =
    ukRow.uk_sold_lots_new !== undefined ||
    ukRow.uk_sold_lots_used !== undefined ||
    ukRow.uk_stock_lots_new !== undefined ||
    ukRow.uk_stock_lots_used !== undefined;

  let wroteToUkCache = false;
  if (hasUkData) {
    const { error } = await supabase
      .from('bricklink_price_guide_cache')
      .upsert(ukRow, { onConflict: 'item_type,item_no,colour_id' });
    if (error) {
      errors.push(`ukCache upsert: ${error.message}`);
      console.warn(`[liveCheckTuple] ukCache upsert failed for ${pgCacheKey(tuple)}:`, error.message);
    } else {
      wroteToUkCache = true;
    }
  }

  let wroteToPartPriceCache = false;
  const partRow = apiPriceGuideToPartPriceCacheFields(tuple, fetches, fetchedAt);
  if (partRow) {
    const { error } = await supabase
      .from('bricklink_part_price_cache')
      .upsert(partRow, { onConflict: 'part_number,colour_id', ignoreDuplicates: false });
    if (error) {
      errors.push(`partPriceCache upsert: ${error.message}`);
      console.warn(`[liveCheckTuple] partPriceCache upsert failed for ${pgCacheKey(tuple)}:`, error.message);
    } else {
      wroteToPartPriceCache = true;
    }
  }

  return {
    tuple,
    fetchedAt,
    requests,
    okCount,
    failedCount,
    errors,
    sold: { N: summariseGuideFetch(fetches.soldNew), U: summariseGuideFetch(fetches.soldUsed) },
    stock: { N: summariseGuideFetch(fetches.stockNew), U: summariseGuideFetch(fetches.stockUsed) },
    wroteToUkCache,
    wroteToPartPriceCache,
    priorCacheAgeDays,
  };
}

/**
 * Live-check a batch of tuples sequentially, spaced ~1.1s apart (BL API politeness, spec
 * §2.2 lane A). Stops cleanly on `RateLimitError` — the client's daily budget gate — and
 * returns the tuples completed so far plus `budgetExhausted: true`. Writes one summary row
 * to `bl_pg_lane_telemetry` (lane='store_api') for the whole batch.
 */
export async function liveCheckBatch(
  client: BrickLinkClient,
  cacheService: PriceGuideCacheService,
  supabase: SupabaseClient,
  tuples: LiveCheckTuple[],
  opts: LiveCheckBatchOptions = {},
): Promise<LiveCheckBatchResult> {
  const spacingMs = opts.spacingMs ?? 1100;
  const startedAt = new Date().toISOString();

  const results: LiveCheckTupleResult[] = [];
  let requestsTotal = 0;
  let ok = 0;
  let failed = 0;
  let budgetExhausted = false;
  let firstBlockAtRequest: number | null = null;

  for (let i = 0; i < tuples.length; i++) {
    if (i > 0) await sleep(spacingMs);
    try {
      const result = await liveCheckTuple(client, cacheService, supabase, tuples[i], opts);
      results.push(result);
      requestsTotal += result.requests;
      ok += result.okCount;
      failed += result.failedCount;
    } catch (err) {
      if (err instanceof RateLimitError) {
        budgetExhausted = true;
        firstBlockAtRequest = requestsTotal + 1;
        break;
      }
      // Unexpected (non-RateLimitError) throw — liveCheckTuple otherwise catches per-call
      // errors internally, so this is a genuinely unexpected failure. Log and move on rather
      // than losing the rest of the batch to one bad tuple.
      failed++;
      console.warn(`[liveCheckBatch] unexpected failure on tuple ${i + 1}/${tuples.length}:`, (err as Error).message);
    }
  }

  const endedAt = new Date().toISOString();
  if (!opts.skipTelemetry) {
    const notes = `live-check batch: ${results.length}/${tuples.length} tuples completed${budgetExhausted ? ', BUDGET EXHAUSTED' : ''}`;
    try {
      const { error } = await supabase.from('bl_pg_lane_telemetry').insert({
        lane: opts.telemetryLane ?? 'store_api',
        session_no: opts.telemetrySessionNo ?? 1,
        requests: requestsTotal,
        ok,
        failed,
        first_block_at_request: firstBlockAtRequest,
        started_at: startedAt,
        ended_at: endedAt,
        notes,
      });
      if (error) throw new Error(error.message);
    } catch (err) {
      console.warn('[liveCheckBatch] telemetry write failed:', (err as Error).message);
    }
  }

  return {
    results,
    tuplesRequested: tuples.length,
    tuplesCompleted: results.length,
    requestsTotal,
    ok,
    failed,
    budgetExhausted,
    firstBlockAtRequest,
  };
}

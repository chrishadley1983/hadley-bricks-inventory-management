/**
 * BrickLink price-guide SUMMARY lane (`priceGuideSummary.asp`, lane C — anon curl).
 *
 * Promotes the 2026-07-07 POC (`scripts/_tmp-curl-fill-uncovered.ts`) to a tested lib
 * module: HTML→quadrant parsing, item-ID resolution (set `-1` suffix + alias hook),
 * the pure URL builder, and the mapping into a `bricklink_pg_summary_cache` row —
 * including the ingest-time currency guard that makes the 2026-07-07 USD-blobs
 * incident (worldwide BrickStore blobs imported as if GBP) structurally impossible
 * going forward (spec §2.2, §7.5).
 *
 * This is the L1 (worldwide summary) lane. It is deliberately separate from the L3
 * catalogPG page engine (`price-guide-page.ts`) — different endpoint, different
 * response shape (4 flat quadrants vs full transaction detail), different lane.
 */

import type { PgItemType } from './price-guide-page';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PgSummaryTuple {
  itemType: PgItemType;
  itemNo: string;
  /** BL colour ID. Should be 0 for non-'P' items — callers may pass either; row
   * builders normalise it. */
  colourId: number;
}

/** One quadrant (sold-new / sold-used / stock-new / stock-used) from the summary page. */
export interface PgSummaryQuad {
  lots: number;
  qty: number;
  min: number | null;
  avg: number | null;
  qavg: number | null;
  max: number | null;
}

export interface PgSummaryQuads {
  soldN: PgSummaryQuad;
  soldU: PgSummaryQuad;
  stockN: PgSummaryQuad;
  stockU: PgSummaryQuad;
}

export const EMPTY_PG_SUMMARY_QUAD: PgSummaryQuad = {
  lots: 0,
  qty: 0,
  min: null,
  avg: null,
  qavg: null,
  max: null,
};

/** Row shape for `bricklink_pg_summary_cache` (columns this module is allowed to set). */
export interface PgSummaryCacheRow {
  item_type: PgItemType;
  item_no: string;
  colour_id: number;
  currency: string;
  no_data: boolean;
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
  stock_new_qavg: number | null;
  stock_new_max: number | null;
  stock_used_lots: number;
  stock_used_qty: number;
  stock_used_min: number | null;
  stock_used_avg: number | null;
  stock_used_qavg: number | null;
  stock_used_max: number | null;
  source: string;
  fetch_identity: string;
  fx_rate: number | null;
  fetched_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// HTML → quadrant parser (POC's parseSnippet, hardened)
// ---------------------------------------------------------------------------

function num(s: string): number {
  return parseInt(s.replace(/,/g, ''), 10);
}

function price(s: string): number | null {
  const m = s.match(/([\d,]+\.?\d*)/);
  return m ? parseFloat(m[1].replace(/,/g, '')) : null;
}

/**
 * Parse a `priceGuideSummary.asp?ajView=Y` HTML snippet into the four quadrants
 * (Past 6 Months Sales × New/Used, Current Items × New/Used). Returns `null` when
 * the snippet doesn't contain a recognisable 4-quadrant structure (unexpected
 * markup / block page / etc.) — callers should treat that as a parse failure, not
 * a genuine "no data" result (a genuine empty item still yields 4 zeroed quads via
 * the "unavailable" branch below).
 */
export function parsePgSummarySnippet(html: string): PgSummaryQuads | null {
  if (!html) return null;
  const cells = html
    .replace(/<[^>]+>/g, '|')
    .replace(/&nbsp;/g, ' ')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  const quads: PgSummaryQuad[] = [];
  let section = 0;
  for (let i = 0; i < cells.length && quads.length < 4; i++) {
    if (/Past 6 Months Sales/i.test(cells[i])) {
      section = 1;
      continue;
    }
    if (/Current Items/i.test(cells[i])) {
      section = 2;
      continue;
    }
    if (section > 0 && /^(New|Used):?$/i.test(cells[i])) {
      const j = i + 1;
      if (j >= cells.length || /unavailable/i.test(cells[j]) || isNaN(num(cells[j]))) {
        quads.push({ ...EMPTY_PG_SUMMARY_QUAD });
        continue;
      }
      quads.push({
        lots: num(cells[j]),
        qty: num(cells[j + 1]),
        min: price(cells[j + 2]),
        avg: price(cells[j + 3]),
        qavg: price(cells[j + 4]),
        max: price(cells[j + 5]),
      });
    }
  }
  if (quads.length !== 4) return null;
  return { soldN: quads[0], soldU: quads[1], stockN: quads[2], stockU: quads[3] };
}

// ---------------------------------------------------------------------------
// Item-ID resolution: set "-1" suffix rule + alias hook
// ---------------------------------------------------------------------------

/**
 * Growing table of BL item-number aliases discovered while chasing residual
 * "unfetchable" tuples (spec §2.2 lane C: "the unfetchable tail is plumbing, not
 * market absence" — set `-1` suffix + alias numbers). Keyed `"<itemType>:<itemNo>"`
 * (the identity as stored in our tables/queue) → the item number BrickLink actually
 * resolves on `priceGuideSummary.asp`/`catalogPG.asp`.
 *
 * Empty at P0: `_bl-pg-deactivated-2026-06-30.ts` and `_bl-pg-bundle-2026-07-02.ts`
 * (checked as candidate sources) both query price guides through the authenticated
 * BL REST client with fully-qualified set IDs already supplied — they never hit an
 * alias/resolution failure worth encoding here. Add entries as residual-fill
 * (`pg-residual-fill.ts`) or refresh sessions discover genuine alias mismatches.
 */
export const ALIAS_MAP: Record<string, string> = {};

/**
 * Resolve the item number BrickLink expects for `priceGuideSummary.asp`/`catalogPG.asp`:
 * apply any known alias, then the set `-1` suffix rule (bare set numbers 404; sets
 * already carrying a `-N` variant suffix pass through unchanged).
 *
 * NOTE: this is purely for building the outbound fetch URL. The tuple's *stored*
 * identity (`item_no` in `bricklink_pg_summary_cache` / `bl_pg_refresh_queue`) stays
 * the bare/raw number as scanned — do not persist the resolved ID.
 */
export function resolvePgItemId(itemType: PgItemType, itemNo: string): string {
  const aliased = ALIAS_MAP[`${itemType}:${itemNo}`] ?? itemNo;
  if (itemType === 'S' && !/-\d+$/.test(aliased)) return `${aliased}-1`;
  return aliased;
}

// ---------------------------------------------------------------------------
// URL builder (pure — uncache token is an argument, never Date.now() internally)
// ---------------------------------------------------------------------------

/**
 * Build the `priceGuideSummary.asp` URL for one tuple. `uncache` is a cache-buster
 * token the caller supplies (e.g. `Date.now()`) — kept as an argument so this stays
 * a pure, unit-testable function.
 */
export function buildPgSummaryUrl(
  itemType: PgItemType,
  itemNo: string,
  colourId: number,
  uncache: number | string,
): string {
  const colour = itemType === 'P' ? colourId : 0;
  const itemId = resolvePgItemId(itemType, itemNo);
  return (
    `https://www.bricklink.com/priceGuideSummary.asp?a=${itemType}&vcID=27&vatInc=N&viewExclude=Y&ajView=Y` +
    `&colorID=${colour}&itemID=${encodeURIComponent(itemId)}&uncache=${uncache}`
  );
}

// ---------------------------------------------------------------------------
// Row mapping (with guards)
// ---------------------------------------------------------------------------

export interface ToSummaryCacheRowOptions {
  /** ISO currency the row's numeric values are denominated in once written. Default 'GBP'. */
  currency?: string;
  /** Non-null ⇒ this row's values were converted from `currency` at this rate. Default null. */
  fxRate?: number | null;
  /** Overrides `fetched_at` (e.g. backdating a harvest import). Default: now. */
  fetchedAt?: string;
  /** Overrides `updated_at`. Default: now. */
  updatedAt?: string;
}

/** Guard: only keep a price when its quadrant actually has lots and a positive value. 4dp. */
function guardedPrice(v: number | null, lots: number): number | null {
  return lots > 0 && v != null && v > 0 ? +v.toFixed(4) : null;
}

/** Map one parsed set of quadrants to a `bricklink_pg_summary_cache` row. */
export function toSummaryCacheRow(
  tuple: PgSummaryTuple,
  quads: PgSummaryQuads,
  sourceLabel: string,
  fetchIdentity: string,
  opts: ToSummaryCacheRowOptions = {},
): PgSummaryCacheRow {
  const colourId = tuple.itemType === 'P' ? tuple.colourId : 0;
  const now = new Date().toISOString();
  const { soldN, soldU, stockN, stockU } = quads;
  return {
    item_type: tuple.itemType,
    item_no: tuple.itemNo,
    colour_id: colourId,
    currency: opts.currency ?? 'GBP',
    no_data: soldN.lots + soldU.lots + stockN.lots + stockU.lots === 0,
    sold6m_new_lots: soldN.lots,
    sold6m_new_qty: soldN.qty,
    sold6m_new_min: guardedPrice(soldN.min, soldN.lots),
    sold6m_new_avg: guardedPrice(soldN.avg, soldN.lots),
    sold6m_new_qavg: guardedPrice(soldN.qavg, soldN.lots),
    sold6m_new_max: guardedPrice(soldN.max, soldN.lots),
    sold6m_used_lots: soldU.lots,
    sold6m_used_qty: soldU.qty,
    sold6m_used_min: guardedPrice(soldU.min, soldU.lots),
    sold6m_used_avg: guardedPrice(soldU.avg, soldU.lots),
    sold6m_used_qavg: guardedPrice(soldU.qavg, soldU.lots),
    sold6m_used_max: guardedPrice(soldU.max, soldU.lots),
    stock_new_lots: stockN.lots,
    stock_new_qty: stockN.qty,
    stock_new_min: guardedPrice(stockN.min, stockN.lots),
    stock_new_avg: guardedPrice(stockN.avg, stockN.lots),
    stock_new_qavg: guardedPrice(stockN.qavg, stockN.lots),
    stock_new_max: guardedPrice(stockN.max, stockN.lots),
    stock_used_lots: stockU.lots,
    stock_used_qty: stockU.qty,
    stock_used_min: guardedPrice(stockU.min, stockU.lots),
    stock_used_avg: guardedPrice(stockU.avg, stockU.lots),
    stock_used_qavg: guardedPrice(stockU.qavg, stockU.lots),
    stock_used_max: guardedPrice(stockU.max, stockU.lots),
    source: sourceLabel,
    fetch_identity: fetchIdentity,
    fx_rate: opts.fxRate ?? null,
    fetched_at: opts.fetchedAt ?? now,
    updated_at: opts.updatedAt ?? now,
  };
}

// ---------------------------------------------------------------------------
// Ingest-time currency validation (the USD-blobs defence — spec §2.2/§7.5)
// ---------------------------------------------------------------------------

export interface CurrencyValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Reject rows whose `currency` isn't GBP unless an `fx_rate` is stamped — the
 * structural guard against the 2026-07-07 incident where worldwide BrickStore
 * blobs (USD, VAT-excluded) were imported without conversion. Call this on every
 * row immediately before upsert; non-conforming rows go to a quarantine report,
 * never silently into the cache.
 */
export function validateCurrencyBasis(row: { currency: string; fx_rate?: number | null }): CurrencyValidationResult {
  if (row.currency === 'GBP') return { ok: true };
  if (row.fx_rate != null && row.fx_rate > 0) return { ok: true };
  return {
    ok: false,
    reason: `currency=${row.currency} has no stamped fx_rate — cannot verify GBP conversion`,
  };
}

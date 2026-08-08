/**
 * Part-first arbitrage — shared types.
 *
 * The inverse lens to bl-basket/store-assessment: instead of picking a store and
 * scoring its lots, start from undervalued high-STR PART tuples (anchors, screened
 * from the UK price-guide cache), find the stores that stock them cheaply
 * (bl_store_lots, the flattened nightly-sweep scrapes), then score each nominated
 * store's whole cached inventory to see whether a concentrated basket clears
 * postage. Everything downstream of nomination reuses the canonical pieces:
 * fees.ts constants, the Bricqer multiplier, the assessment damage filter and the
 * common bl-store-report decision module.
 */

export interface PartArbInputs {
  /** Anchor gate: house STR (sold_lots / stock_lots) must be at least this. */
  minStrLots: number;
  /** Anchor gate: UK sold qty over 6 months — demand frequency, NOT value (a 50p
   * part sold 10 times qualifies; there is deliberately no sold-value floor). */
  minSoldQty: number;
  /** Ignore asks below this (penny junk / listing noise). */
  minAsk: number;
  /** Net-margin threshold (fraction of list) for viability. */
  minMargin: number;
  /** Basket lot STR (qty basis) gate for the scored basket ("0" = let the report's
   * gate ladder present the bands). */
  minStr: number;
  /** Inbound postage estimate for the basket summary (charged whole, standalone rule). */
  shipping: number;
  /** Anchor must have at least this many units listed below maxViableAsk. */
  minUnitsBuyable: number;
}

/** An undervalued, high-STR part/minifig tuple surfaced by the anchor screen. */
export interface AnchorTuple {
  itemType: 'P' | 'M';
  itemNo: string;
  colourId: number;
  itemName: string | null;
  condition: 'N' | 'U';
  /** UK 6-mo sold lot average — the benchmark the Bricqer formula prices from. */
  soldAvg: number;
  soldQty: number;
  soldLots: number;
  stockLots: number;
  stockQty: number;
  /** House STR (sold_lots / stock_lots). */
  strLots: number;
  /** Qty-basis STR (Bricqer pricing input). */
  strQty: number | null;
  /** Our projected list (UK 6MA x Bricqer multiplier, 4p floor). */
  listPrice: number;
  /** Highest ask that still clears minMargin after the 9.4% fee stack (ex-postage). */
  maxViableAsk: number;
  /** Units in the UK stock histogram priced within [minAsk, maxViableAsk] — market
   * depth cheap enough to hit margin. Conservative: the rolled-up "other" bucket
   * has no known price and is never counted. */
  unitsBuyable: number;
  stockMin: number | null;
}

/** One row of bl_store_lots (flattened scrape), as returned by Supabase. */
export interface FlatStoreLot {
  store_slug: string;
  inv_id: number;
  item_type: 'P' | 'S' | 'M';
  item_no: string;
  colour_id: number;
  condition: 'N' | 'U';
  inv_qty: number;
  unit_price_gbp: number;
  scanned_at: string;
}

/** An anchor found in a specific store at a viable ask. */
export interface AnchorHit {
  anchor: AnchorTuple;
  storeSlug: string;
  invId: number;
  ask: number;
  qty: number;
  /** list x (1 - VAR_FEE_PCT) - ask, per unit, ex-postage. */
  netPerUnit: number;
  scannedAt: string;
}

/** A store nominated by one or more anchor hits, ranked for basket concentration. */
export interface StoreNomination {
  storeSlug: string;
  hits: AnchorHit[];
  /** Sum of hit net x qty, uncapped, ex-postage — a nomination-ranking signal only;
   * the real basket figures come from the common decision report. */
  anchorNetExPostage: number;
  /** Oldest scan among the hits — how stale the evidence is. */
  oldestScanAt: string;
}

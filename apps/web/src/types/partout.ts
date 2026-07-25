/**
 * Partout Value Types
 *
 * Types for calculating and displaying the total value of a LEGO set's
 * individual parts if sold separately on BrickLink.
 */

import type { BrickLinkItemType } from '@/lib/bricklink/types';
import type { OverlapTag } from '@/lib/bl-store-assessment/overlap';

export type PartoutCondition = 'new' | 'used';

/** Complete partout analysis data returned from the API */
export interface PartoutData {
  setNumber: string;
  totalParts: number;
  povNew: number;
  povUsed: number;
  setPrice: {
    new: number | null;
    used: number | null;
  };
  ratioNew: number | null;
  ratioUsed: number | null;
  recommendation: 'part-out' | 'sell-complete';
  cacheStats: {
    fromCache: number;
    fromApi: number;
    total: number;
  };
  parts: PartValue[];
  /**
   * Canonical assessment per condition — the honesty ladder, part-out gate, STR
   * bands, magnets, value concentration and store overlap. Null only when the
   * assessment could not be computed (no parts).
   */
  assessment: { new: PartoutAssessment; used: PartoutAssessment } | null;
}

/** One inclusive STR gate row — "lots at STR ≥ gate". Mirrors the store-report ladder. */
export interface PartoutStrBand {
  /** Inclusive qty-basis STR floor (from STR_GATES). */
  gate: number;
  /** Distinct part lots at or above this gate (priced lots only). */
  lots: number;
  /** Total pieces across those lots. */
  qty: number;
  /** Σ qty × price for those lots. */
  grossValue: number;
  /** Σ qty × price × f(STR) for those lots. */
  realisableValue: number;
  /** grossValue as a share of the set's total gross POV (0–1). */
  shareOfPov: number;
}

/**
 * A magnet lot: very low worldwide supply + decent sell-through. Flagged
 * independently of the margin gate — magnets pull buyers to the store even when
 * the set as a whole fails the part-out gate.
 */
export interface PartoutMagnet {
  partNumber: string;
  partType: BrickLinkItemType;
  name: string;
  colourId: number;
  colourName: string;
  imageUrl: string;
  quantity: number;
  price: number | null;
  /** Qty-basis STR fraction. */
  str: number | null;
  /** Worldwide seller lots — the scarcity side of the magnet test. */
  worldSupplyLots: number | null;
  /** quantity × price. */
  lineValue: number;
  /** Our own holding of this part+colour, when the overlap index was available. */
  overlap: OverlapTag | null;
}

/** Where the money sits — concentration of POV across lots and item types. */
export interface PartoutConcentration {
  /** Highest-value lots, descending. */
  topLots: Array<{
    partNumber: string;
    name: string;
    colourName: string;
    quantity: number;
    lineValue: number;
    shareOfPov: number;
  }>;
  /** Share of gross POV held by the top 10 lots (0–1). */
  top10Share: number;
  /** How many lots it takes to reach 50% of gross POV. */
  lotsToHalfPov: number;
  /** Gross POV split by catalogue item type. */
  byType: { minifig: number; part: number; other: number };
}

/** Overlap of the set's parts against our own Bricqer stock. */
export interface PartoutOverlapSummary {
  /** bricqer_snapshot_meta.last_full_sync — staleness is surfaced, never hidden. */
  snapshotAt: string | null;
  salesWindowDays: number;
  counts: { NEW: number; RESTOCK_OUT: number; RESTOCK_THIN: number; DUPLICATE: number };
  /** Gross POV of lots additional to our store (NEW + RESTOCK_OUT). */
  additionalValue: number;
  /** Gross POV of lots we already hold in depth (DUPLICATE). */
  duplicateValue: number;
}

/**
 * Canonical part-out assessment for one condition.
 *
 * The headline is the honesty ladder — gross → realisable → net — mirroring the
 * bl-store-report rule that the raw figure flatters and must never lead alone.
 */
export interface PartoutAssessment {
  condition: PartoutCondition;
  /** Σ qty × price. Assumes every lot clears at guide price. */
  grossPov: number;
  /**
   * Gross discounted by the STR capture curve. INFORMATIONAL ONLY — it does not move
   * netPov or maxBuy. The capture curve is still uncalibrated (`TODO(calibration)` in
   * liquidity-pov.ts), so it is shown as a liquidity sense-check rather than allowed to
   * set the money figures.
   */
  realisablePov: number;
  /** realisablePov ÷ grossPov (0 when gross is 0). */
  captureRate: number;
  /** grossPov after the 9.4% variable fee stack — the decision figure. */
  netPov: number;
  /** The fee stack applied (VAR_FEE_PCT), echoed so the card is self-describing. */
  feePct: number;
  /** Complete-set price used as the gate's ask basis. */
  setPrice: number | null;
  /** grossPov ÷ setPrice — the canonical gate basis (matches store-assessment SETS). */
  povMultiple: number | null;
  /** grossPov − setPrice. */
  gapGbp: number | null;
  /**
   * Two questions live here, and only one of them needs a complete-set price:
   *
   *  - PRIORITY (part out vs sell whole) — a comparison, so it needs the set price.
   *  - ACQUISITION (worth doing at all, and up to what buy price) — needs only the
   *    realisable POV.
   *
   * A missing set price used to collapse both into SKIP, which reported "insufficient
   * data" directly above a Max Buy card that had already answered the second question.
   * It now narrows the answer instead of withholding it.
   */
  verdict:
    | 'PART-OUT' // gate cleared against the complete-set price
    | 'SELL-COMPLETE' // complete beats parting out
    | 'PART-OUT-BELOW' // no complete-set price to compare — but viable under max buy
    | 'NOT-VIABLE' // max buy is at or below zero: no purchase price makes it work
    | 'SKIP'; // no priced parts at all — nothing to value
  /** Plain-English reason the verdict landed where it did. */
  verdictReason: string;
  /** Echo of the gate thresholds actually applied. */
  gate: { povMultipleMin: number; minGapGbp: number };
  /** Most we should pay for the set and still hit the target margin on a part-out. */
  maxBuy: {
    targetMargin: number;
    /**
     * Inbound postage, deducted as a CASH cost rather than a percentage — you pay it on
     * top of the purchase price, so it comes straight off the ceiling.
     */
    postageGbp: number;
    /** Ceiling before postage: realisable × (1 − fees − margin). */
    beforePostage: number | null;
    /**
     * The usable ceiling. Deliberately NOT clamped at zero — a negative figure is the
     * finding ("no purchase price makes this work"), and clamping would disguise it as
     * a free set. Teardown labour is intentionally absent: it is already priced into the
     * 2× POV gate and the target margin, so charging it again would double-count.
     */
    price: number | null;
  };
  strBands: PartoutStrBand[];
  magnets: PartoutMagnet[];
  concentration: PartoutConcentration;
  /** Null when no Bricqer snapshot was available for this user. */
  overlap: PartoutOverlapSummary | null;
  /** Lots with a usable price. */
  pricedLots: number;
  /** Lots with no UK price data — these contribute £0 and understate POV. */
  unpricedLots: number;
  /**
   * How many lots the magnet test could actually be applied to.
   *
   * Magnets need worldwide supply from `bricklink_pg_summary_cache`. That read is
   * non-fatal — a failure (or thin coverage) yields an empty supply map, and every lot
   * then silently fails the scarcity leg. Without this, "no magnets" is indistinguishable
   * from "we couldn't check", and the panel would be asserting absence from missing
   * evidence. Surface the denominator so the UI can tell the two apart.
   */
  magnetCoverage: { withSupplyData: number; total: number };
}

/** Individual part value in the partout analysis */
export interface PartValue {
  partNumber: string;
  partType: BrickLinkItemType;
  name: string;
  colourId: number;
  colourName: string;
  imageUrl: string;
  quantity: number;
  priceNew: number | null;
  priceUsed: number | null;
  totalNew: number;
  totalUsed: number;
  /** Sell-through rate for New condition — LOTS basis, ×100 (display legacy). */
  sellThroughRateNew: number | null;
  /** Sell-through rate for Used condition — LOTS basis, ×100 (display legacy). */
  sellThroughRateUsed: number | null;
  /**
   * QUANTITY-basis STR as a fraction (sold_qty ÷ stock_qty) for New.
   * This is the house standard (Chris 2026-07-14, consistent with bl-basket) and is
   * what every gate, magnet test and capture-curve lookup must use — never the
   * lots-basis ×100 fields above.
   */
  strQtyNew: number | null;
  /** QUANTITY-basis STR as a fraction for Used. See `strQtyNew`. */
  strQtyUsed: number | null;
  /** Worldwide seller lots (New) from `bricklink_pg_summary_cache` — magnet input. */
  worldSupplyLotsNew: number | null;
  /** Worldwide seller lots (Used) from `bricklink_pg_summary_cache` — magnet input. */
  worldSupplyLotsUsed: number | null;
  /** Overlap vs our own Bricqer stock (New). Null when no overlap index was loaded. */
  overlapNew: OverlapTag | null;
  /** Overlap vs our own Bricqer stock (Used). Null when no overlap index was loaded. */
  overlapUsed: OverlapTag | null;
  /** Units of this part+colour we currently hold (New) — null when no overlap index. */
  ourQtyNew: number | null;
  /** Units of this part+colour we currently hold (Used) — null when no overlap index. */
  ourQtyUsed: number | null;
  /** Number of lots available for New condition */
  stockAvailableNew: number | null;
  /** Number of lots available for Used condition */
  stockAvailableUsed: number | null;
  /** Number of times sold for New condition */
  timesSoldNew: number | null;
  /** Number of times sold for Used condition */
  timesSoldUsed: number | null;
  fromCache: boolean;
}

/** Part identifier for cache lookups */
export interface PartIdentifier {
  partNumber: string;
  partType: BrickLinkItemType;
  colourId: number;
  colourName?: string;
  name: string;
  quantity: number;
}

/** Cached part price from database */
export interface CachedPartPrice {
  partNumber: string;
  partType: string;
  colourId: number;
  colourName: string | null;
  priceNew: number | null;
  priceUsed: number | null;
  sellThroughRateNew: number | null;
  sellThroughRateUsed: number | null;
  stockAvailableNew: number | null;
  stockAvailableUsed: number | null;
  timesSoldNew: number | null;
  timesSoldUsed: number | null;
  fetchedAt: Date;
}

/** Result of cache lookup */
export interface CacheLookupResult {
  cached: CachedPartWithIdentifier[];
  uncached: PartIdentifier[];
}

/** Cached price with part identifier for combining results */
export interface CachedPartWithIdentifier extends CachedPartPrice {
  name: string;
  quantity: number;
}

/** Part price data to insert/update in cache */
export interface PartPriceData {
  partNumber: string;
  partType: string;
  colourId: number;
  colourName: string | null;
  priceNew: number | null;
  priceUsed: number | null;
  sellThroughRateNew: number | null;
  sellThroughRateUsed: number | null;
  stockAvailableNew: number | null;
  stockAvailableUsed: number | null;
  timesSoldNew: number | null;
  timesSoldUsed: number | null;
}

/** Progress callback for batch fetching */
export type PartoutProgressCallback = (fetched: number, total: number, cached: number) => void;

/** Partout API response */
export interface PartoutApiResponse {
  data: PartoutData;
}

/** Partout API error response */
export interface PartoutApiError {
  error: string;
  details?: unknown;
}

/** Phase of the partout streaming fetch */
export type PartoutStreamPhase = 'fetching-colors' | 'fetching-subsets' | 'fetching-parts';

/** Server-Sent Event types for partout streaming */
export interface PartoutStreamEvent {
  type: 'start' | 'phase' | 'progress' | 'complete' | 'error';
  message?: string;
  phase?: PartoutStreamPhase;
  fetched?: number;
  total?: number;
  cached?: number;
  data?: PartoutData;
  error?: string;
}

/** Progress state for streaming fetch in UI */
export interface StreamProgress {
  fetched: number;
  total: number;
  cached: number;
}

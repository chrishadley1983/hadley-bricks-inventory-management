/**
 * BL Store Assessment — shared types.
 *
 * Assesses an EXTERNAL BrickLink seller (an arbitrage target) from a single
 * store scrape joined against the cached price-guide / STR / POV layers. This is
 * the "assess" lens of the BL Arbitrage skill (sibling to bl-basket's "buy" lens).
 *
 * Nothing here talks to the network — `computeStoreAssessment` takes an already
 * scraped inventory + store profile and reads the Supabase caches.
 */

import { FEE_MODEL, MAGNET } from '../bricklink/fees';

export type ItemTypeCode = 'P' | 'S' | 'M';
export type Condition = 'N' | 'U';
export type AssessMode = 'light' | 'full';

/** One scraped lot from the seller's store (mirrors bl-basket `ScrapedItem`). */
export interface StoreLot {
  invID: number;
  itemType: ItemTypeCode;
  itemNo: string;
  colourId: number; // BL colour id (0 for sets/minifigs)
  colourName: string | null;
  itemName: string;
  invNew: string; // 'New' | 'Used'
  invComplete: string | null; // set completeness (Complete/Incomplete/Sealed)
  invQty: number;
  unitPriceGBP: number;
  /** True when a bare-series CMF listing was resolved to its per-figure catalog id by
   * name match (cmf-resolve.ts) — the lot then prices against the correct guide. */
  cmfResolved?: boolean;
  description: string | null; // seller remarks / condition note
}

/** Seller feedback + order-rate proxy (from the store-profile scrape). */
export interface StoreProfile {
  storeId: number;
  storeName: string | null;
  country: string | null;
  feedbackScore: number | null; // net positive feedback count
  positivePct: number | null; // 0..100
  feedbackLast6mo: number | null; // feedback received in last 6 months
  ordersPerMonth: number | null; // proxy = feedbackLast6mo / 6
  memberSince: string | null;
  scrapedAt: string;
}

export interface AssessmentInputs {
  minAsk: number; // ignore lots priced below this (default 0.10)
  minMargin: number; // net margin threshold for "within margin" (default 0.20)
  minStr: number; // "decent" STR (lots basis) for high-STR + magnets (default 0.5)
  magnetMaxSupplyLots: number; // "very low supply" ceiling — worldwide seller lots (default 3)
  inboundPerUnit: number; // inbound postage allocated per unit in margin calc (default 0 = ex-postage)
  cacheTtlDays: number | null; // UK price-guide freshness gate (null = accept any age)
  feeModel: { blFee: number; bricqerFee: number; paypalPct: number };
  /**
   * Pricing lens (Chris 2026-07-14). true = GROUNDED: UK data only — a checked tuple
   * with no UK sales is ground truth, never world-estimated. false = ESTIMATE: world
   * fallback (+11% calibration) fills gaps — triage of unswept stores. undefined = AUTO:
   * grounded once ≥95% of the store's tuples have been price-checked.
   */
  ukGroundedOnly?: boolean;
}

/** Where the market benchmark for a lot came from. */
export type PriceSource = 'uk' | 'world' | 'none';

/** Bucketed pricing position vs UK market (mirrors store-quality classifyPosition). */
export type PricePosition = 'UNDER' | 'KEEN' | 'AT-MARKET' | 'PREMIUM' | 'OVER' | 'UNKNOWN';

/** A fully-scored lot — the atom the sections are built from. */
export interface ScoredLot {
  invID: number;
  itemType: ItemTypeCode;
  itemNo: string;
  /** Bare-series CMF listing resolved to this per-figure id by name (cmf-resolve.ts). */
  cmfResolved?: boolean;
  colourId: number;
  colourName: string | null;
  itemName: string;
  condition: Condition;
  invQty: number;
  ask: number; // their unit price (GBP)
  lotAskValue: number; // ask × qty
  damageNote: boolean;
  // Market benchmark (UK 6mo sold avg where covered; worldwide avg ×UK uplift otherwise —
  // see priceSource for provenance)
  benchmarkAvg: number | null;
  strLots: number | null; // sold_lots / stock_lots (house STR)
  strQty: number | null; // sold_qty / stock_qty (Bricqer pricing input)
  worldSupplyLots: number | null; // worldwide stock lots (seller count) for this condition
  demandRank: number | null;
  priceSource: PriceSource;
  askVsMarket: number | null; // ask ÷ benchmarkAvg
  position: PricePosition;
  // Arbitrage math (what WE'd realise reselling it)
  ourList: number | null; // Bricqer list (P/M) or set sold avg (S)
  netPerUnit: number | null; // ourList·(1−fees) − ask − inbound
  marginPct: number | null;
  lotProfit: number | null; // netPerUnit × qty
  withinMargin: boolean;
  // Highlights
  highStr: boolean;
  magnet: boolean;
  // Overlap vs OUR store (engine v3+; null = sets / no index available)
  overlap: OverlapTagValue | null;
  ourQty: number | null; // our current stocked qty for this (item, colour, condition)
  ourSoldWindow: number | null; // units WE sold in the sales window
  // Liquidity / ceiling advisories (engine v7; absent on older persisted rows)
  /** Market 6-mo sold qty for this condition — the demand-cap input. Null = no benchmark. */
  marketSoldQty6mo?: number | null;
  /** Share of 6-mo sold QTY at/above our projected list (UK histogram; null when unavailable).
   * Low share = the sw0775 trap: STR says it sells, but not at our price. */
  soldShareAtList?: number | null;
}

/** Mirror of overlap.ts OverlapTag (kept here so section shapes don't import the loader). */
export type OverlapTagValue = 'NEW' | 'RESTOCK_OUT' | 'RESTOCK_THIN' | 'DUPLICATE';

// ---- Section shapes -------------------------------------------------------

export interface Bucket {
  key: string;
  lots: number;
  pieces: number;
  value: number;
  valueShare: number;
}

export interface SizeSection {
  totalLots: number;
  totalPieces: number;
  totalValue: number;
  avgValuePerLot: number;
  medianLotPrice: number;
  byType: Bucket[]; // P / S / M
  biggestLots: ScoredLot[]; // top by lot ask value
}

export interface PricingSection {
  covered: number; // lots with a usable benchmark
  weightedMedianAskVsMarket: number | null;
  label: 'cheap' | 'at-market' | 'premium' | 'unknown';
  positions: Bucket[]; // UNDER / KEEN / AT-MARKET / PREMIUM / OVER
}

export interface PartMixCell {
  itemType: ItemTypeCode;
  condition: Condition;
  lots: number;
  pieces: number;
  value: number;
}

export interface PartMixSection {
  matrix: PartMixCell[];
  newValueShare: number;
  usedValueShare: number;
  damageNoteShare: number; // share of used lots carrying a genuine damage note
  setCompleteness: { complete: number; incomplete: number; sealed: number; unknown: number };
}

export interface MarginSection {
  lots: number;
  outlay: number;
  projectedNet: number;
  blendedMarginPct: number | null;
  roiPct: number | null;
  top: ScoredLot[]; // best lots by lot profit
}

export interface HighStrSection {
  lots: number;
  value: number;
  alsoWithinMargin: number;
  top: ScoredLot[]; // sorted by strLots desc
}

export interface MagnetSection {
  lots: number;
  value: number;
  alsoWithinMargin: number;
  top: ScoredLot[]; // scarce (low supply) + decent STR, sorted by scarcity then STR
}

export interface ConfidenceSection {
  ukValueShare: number; // strong: UK price data
  worldValueShare: number; // weaker: worldwide fallback
  noneValueShare: number; // no benchmark
  ukLotShare: number;
}

export interface AgeingSection {
  buckets: Bucket[]; // fresh / normal / overstock / dead / no-data
  /** (overstock + dead) ÷ BENCHMARKED value — no-data lots are excluded, not counted as dead. */
  overstockValueShare: number;
  /** Share of store value that had a sold-rate benchmark at all (the denominator above). */
  benchmarkedValueShare: number;
  motivatedSeller: boolean;
}

export interface ConcentrationSection {
  top10ValueShare: number;
  distinctItems: number;
}

export interface OverlapTagStat {
  tag: OverlapTagValue;
  lots: number;
  outlay: number; // ask × qty summed over buyable lots with this tag
  projectedNet: number;
}

/**
 * How the store's BUYABLE lots overlap our own inventory. "Fresh demand" = NEW +
 * RESTOCK_OUT — lots that widen the catalogue or refill proven sellers, the buys
 * that don't cannibalise existing depth.
 */
export interface OverlapSection {
  available: boolean; // false when no user index was supplied (or old rows)
  snapshotAt: string | null; // our Bricqer snapshot freshness
  salesWindowDays: number | null;
  buyableTags: OverlapTagStat[]; // NEW / RESTOCK_OUT / RESTOCK_THIN / DUPLICATE over withinMargin lots
  untaggedBuyableLots: number; // buyable sets (no Bricqer home) — outside the tag scheme
  freshNetShare: number | null; // share of buyable projected net from NEW + RESTOCK_OUT
}

/**
 * Proper sets (S-type, excluding complete CMFs) are a DIFFERENT buying decision from the
 * parts/minifig arbitrage: flip complete on Amazon (new), sell at BL market (either
 * condition), or part out (POV). Scored separately, never mixed into the parts grade —
 * different capital and velocity profile (Chris 2026-07-14).
 */
export interface SetDecisionRow {
  itemNo: string;
  setName: string | null;
  condition: Condition;
  invQty: number;
  ask: number;
  /** Net if sold at BL whole-set 6mo sold avg (same fee model as parts). */
  blNet: number | null;
  /** Amazon buy box (latest snapshot) — only when the ASIN mapping is trusted. */
  amazonBuyBox: number | null;
  /** Net per unit flipping FBM at buy box (referral+DST+VAT+shipping model). New only. */
  amazonNet: number | null;
  asinTrusted: boolean;
  /** eBay NEW lowest listing — context only (we have no eBay sold data). */
  ebayNewMin: number | null;
  /** Part-out value (condition-matched 6mo sold basis) and its multiple of the ask. */
  povGbp: number | null;
  povMultiple: number | null;
  verdict: 'FLIP-AMAZON' | 'SELL-BL' | 'PART-OUT' | 'SKIP';
  /** Best channel net per unit (POV is a signal, not a net — excluded from bestNet). */
  bestNet: number | null;
}

/** One sales-method row of the SETS table (approved format 2026-07-14). */
export interface SetsMethodRow {
  lots: number;
  outlay: number;
  net: number;
}

export interface SetsSection {
  lots: number; // all S-type lots
  askValue: number;
  /** Per-method breakdown — how the sets margin is achieved. */
  methods: {
    flipAmazon: SetsMethodRow; // buy box via trusted ASIN, FBM fees (NEW only)
    sellBl: SetsMethodRow; // sell complete at BL 6-mo avg (condition-matched)
    partOut: SetsMethodRow; // POV ≥2× ask and ≥£10 gap (net = POV-ask signal, not booked)
    skip: SetsMethodRow; // priced, no margin on any channel
    cmfIdentified: SetsMethodRow; // per-figure CMFs (suffixed or name-resolved), sellable on BL
    cmfNoIdentity: SetsMethodRow; // bare-series CMFs that could NOT be resolved — unpriceable
  };
  /** Bare-CMF lots recovered by the name resolver this run. */
  cmfResolvedCount: number;
  totalSellable: SetsMethodRow;
  /** Per-set detail (top N by net) — persisted for drill-down; not all rendered. */
  decided: SetDecisionRow[];
}

/** One INCLUSIVE STR gate column (Chris 2026-07-14: cumulative "STR ≥ g", metrics as rows). */
export interface StrGateColumn {
  gate: number; // 0, 0.25, 0.5, 0.75, 1.0
  lots: number; // withinMargin lots at this gate
  outlay: number;
  net: number;
  marginPct: number | null; // net / list value
  roiPct: number | null; // net / outlay
  medianStr: number | null;
  /** Median market months-of-supply (≈ 6 / STR-qty) across the gated lots. */
  medianMonths: number | null;
  /** Months by which ~80% of the gate's net clears (profit-weighted 80th pct of months). */
  monthsTo80PctNet: number | null;
  /** Net £ per lot per month — capital/labour velocity. */
  capacityPerLotMo: number | null;
  /** Lots additional to OUR store (overlap NEW + RESTOCK_OUT); 0 when no overlap index. */
  addlLots: number;
  addlNet: number;
  /** P/M vs S split of the gate (engine emits these; formalised in v7). */
  pmLots?: number;
  pmNet?: number;
  setLots?: number;
  setNet?: number;
}

export interface StrCoverageSection {
  /** Benchmark provenance over all scored lots. */
  coverage: { totalLots: number; ukLots: number; worldLots: number; noneLots: number };
  gates: StrGateColumn[];
}

export interface Verdict {
  grade: number; // 0..100 Arbitrage Attractiveness
  label: 'BUY' | 'REVIEW' | 'SKIP';
  headline: string;
  reasons: string[];
  /**
   * Cherry-pick-first signal breakdown (each 0..1):
   * value = buyable net + breadth (the money on the table — dominant weight),
   * efficiency = ROI on the buyable outlay,
   * magnet = scarce-and-selling lots,
   * price = whole-store price posture (search-cost modifier, minority weight),
   * coverage = benchmark confidence (UK full, world-fallback half).
   */
  signals: { value: number; efficiency: number; magnet: number; price: number; coverage: number };
}

export interface StoreAssessment {
  /** Bumped when scoring semantics change — persisted rows carry the version they were built with. */
  engineVersion: number;
  store: { slug: string; storeId: number | null; storeName: string | null; country: string | null };
  mode: AssessMode;
  scannedAt: string;
  /** True when the inventory scan hit its page cap (or stopped early) — totals understate the store. */
  scanTruncated: boolean;
  inputs: AssessmentInputs;
  verdict: Verdict;
  size: SizeSection;
  pricing: PricingSection;
  feedback: StoreProfile | null;
  partMix: PartMixSection;
  withinMargin: MarginSection;
  highStr: HighStrSection;
  magnets: MagnetSection;
  confidence: ConfidenceSection;
  ageing: AgeingSection;
  concentration: ConcentrationSection;
  overlap: OverlapSection;
  /** Proper-set decisions (separate from the parts grade). Absent on pre-v4 rows. */
  sets?: SetsSection;
  /** STR × coverage band breakdown (Chris 2026-07-14: wanted on every store summary). */
  strCoverage?: StrCoverageSection;
  /**
   * Common decision-report headline (lib/bl-store-report, 2026-07-19): the honesty
   * ladder raw → demand-capped → liquid (STR≥gate, no DUPs, capped, standalone
   * postage). Stamped by the CLI after assembly; the Discord card leads with
   * liquidNet instead of the flattering uncapped figure. Inline shape (not the
   * module's type) to avoid an import cycle. Absent on pre-v7 rows.
   */
  decision?: {
    rawNet: number;
    cappedNet: number;
    liquidNet: number;
    liquidLots: number;
    liquidOutlay: number;
    liquidGate: number;
    inboundPostage: number;
  };
}

export const DEFAULT_INPUTS: AssessmentInputs = {
  minAsk: 0.10,
  minMargin: 0.20,
  minStr: MAGNET.minStr,
  magnetMaxSupplyLots: MAGNET.maxSupplyLots,
  inboundPerUnit: 0,
  cacheTtlDays: 90,
  feeModel: { ...FEE_MODEL },
};

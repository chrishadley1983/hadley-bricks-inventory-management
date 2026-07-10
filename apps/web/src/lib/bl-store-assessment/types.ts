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
}

export const DEFAULT_INPUTS: AssessmentInputs = {
  minAsk: 0.10,
  minMargin: 0.20,
  minStr: 0.5,
  magnetMaxSupplyLots: 3,
  inboundPerUnit: 0,
  cacheTtlDays: 90,
  feeModel: { blFee: 0.03, bricqerFee: 0.035, paypalPct: 0.029 },
};

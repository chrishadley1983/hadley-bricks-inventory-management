/**
 * Store-quality engine — shared types.
 *
 * See docs/store-quality/store-quality-framework.md for the design these encode.
 */

export type Segment = 'parts' | 'minifigs' | 'all';

/**
 * Velocity class per lot. Realized (our own) sales come first; market STR is the
 * fallback for stock we've never sold.
 */
export type VelocityClass =
  | 'MOVER' // we sell it, healthy days-of-cover
  | 'OVERSTOCK' // we sell it but days-of-cover > 365
  | 'MARKET-ONLY' // never sold by us, market STR says it should sell
  | 'SLOW' // never sold by us, modest market STR
  | 'DEAD' // never sold by us, ~zero market STR
  | 'BLIND'; // never sold by us, no market STR data at all

export type PricePosition =
  | 'UNDER' // < 0.70 of 6mo avg
  | 'KEEN' // 0.70–0.95
  | 'AT-MARKET' // 0.95–1.15
  | 'PREMIUM' // 1.15–1.50
  | 'OVER' // > 1.50
  | 'UNKNOWN'; // no 6mo avg to compare

export type LotFlag =
  | 'STUCK-HIGH'
  | 'UNDER-PRICED'
  | 'OVERSTOCK'
  | 'DEAD'
  | 'LOW-YIELD-PICK'
  | 'BLIND-HIGH-VALUE';

/** A single stock lot enriched with cached market + our realized-sales signals. */
export interface EnrichedLot {
  itemNumber: string;
  itemName: string;
  itemType: 'Part' | 'Minifig';
  colorId: number | null;
  colorName: string | null;
  condition: string; // 'New' | 'Used'
  quantity: number;
  bricqerPrice: number;
  storageLocation: string | null;
  listValue: number; // quantity × bricqerPrice

  // cached market signals
  sixMonthAvg: number | null;
  marketStrRatio: number | null; // raw ratio (cached pct ÷ 100); null = no data, 0 = real zero
  priceRatio: number | null; // bricqerPrice ÷ sixMonthAvg

  // our realized sales (window)
  unitsSold: number;
  ordersWith: number;
  lastSoldDaysAgo: number | null;
  daysOfCover: number | null;

  velocity: VelocityClass;
  pricePosition: PricePosition;
  flags: LotFlag[];
}

export interface DimensionScore {
  key: 'velocity' | 'picking' | 'margin' | 'ageing' | 'coverage' | 'freshness';
  label: string;
  weight: number; // 0–1
  score: number; // 0–100
  detail: string;
}

export interface CompositionRow {
  label: string;
  lots: number;
  pieces: number;
  value: number;
  share: number; // value share 0–1
}

export interface ProfileRow {
  bucket: string;
  lots: number;
  value: number;
  valueShare: number;
}

export interface ActionItem {
  flag: LotFlag;
  itemNumber: string;
  itemName: string;
  colorName: string | null;
  condition: string;
  quantity: number;
  bricqerPrice: number;
  listValue: number;
  sixMonthAvg: number | null;
  priceRatio: number | null;
  marketStrRatio: number | null;
  note: string;
}

export interface StoreQualityResult {
  generatedAt: string;
  snapshotDate: string | null;
  snapshotAgeDays: number | null;
  stale: boolean;
  segment: Segment;
  windowDays: number;

  totals: { lots: number; pieces: number; value: number };
  composition: CompositionRow[];

  compositeScore: number;
  dimensions: DimensionScore[];

  velocityProfile: ProfileRow[];
  pricePositionProfile: ProfileRow[];
  picking: {
    avgValuePerLot: number;
    subFloorLotShare: number; // < 10p
    subFloorValueShare: number;
    distinctLocations: number;
    lotsPerLocation: number;
    grindOrderPickShare: number | null; // from realized orders, if computed
  };
  coverage: {
    priceCoverage: number; // value share with a usable 6mo avg
    velocityCoverage: number; // value share with realized sale OR market STR
    blindHighValue: ActionItem[];
  };

  actions: Record<LotFlag, ActionItem[]>;

  /** Compact summary persisted to store_quality_runs. */
  summary: Record<string, number | string | null>;
}

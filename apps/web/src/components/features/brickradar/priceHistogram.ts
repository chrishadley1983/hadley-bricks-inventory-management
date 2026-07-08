import type { PgHist } from './types';

export interface PriceHistogramBucket {
  label: string;
  rangeStart: number;
  qty: number;
  /** true for the single bucket that contains the Bricqer floor (£0.0699). */
  isFloorBucket: boolean;
}

export interface PriceHistogramResult {
  buckets: PriceHistogramBucket[];
  totalQty: number;
  otherQty: number;
}

/**
 * Bucket the `hist` keyed-object (exact-price → qty, from the catalogPG scrape's
 * uk_detail.soldNew/soldUsed.hist, parse_version=3+ only) into fixed-width price
 * ranges for a readable bar chart — "qty per price bucket" is the ask, not one
 * bar per exact observed price (which can run to 150 distinct values).
 */
export function buildPriceHistogram(hist: PgHist | null | undefined, floor = 0.0699): PriceHistogramResult | null {
  if (!hist) return null;

  const entries = Object.entries(hist)
    .filter(([k]) => k !== 'other')
    .map(([k, qty]) => [Number(k), qty] as [number, number])
    .filter(([price, qty]) => Number.isFinite(price) && qty > 0);

  const otherQty = hist.other ?? 0;

  if (entries.length === 0 && otherQty === 0) return null;

  if (entries.length === 0) {
    return { buckets: [], totalQty: otherQty, otherQty };
  }

  const prices = entries.map(([p]) => p);
  const min = Math.min(...prices, floor);
  const max = Math.max(...prices);
  const range = Math.max(max - min, 0.01);

  // Bucket width ladder — keeps a chart to a manageable ~15-30 bars regardless of range.
  const width = range <= 1 ? 0.05 : range <= 3 ? 0.1 : range <= 8 ? 0.25 : range <= 20 ? 0.5 : 1;

  const startPrice = Math.floor(min / width) * width;
  const bucketCount = Math.ceil((max - startPrice) / width) + 1;

  const counts = new Array<number>(bucketCount).fill(0);
  for (const [price, qty] of entries) {
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((price - startPrice) / width)));
    counts[idx] += qty;
  }

  const floorIdx = Math.min(bucketCount - 1, Math.max(0, Math.floor((floor - startPrice) / width)));

  const buckets: PriceHistogramBucket[] = counts.map((qty, i) => {
    const rangeStart = startPrice + i * width;
    return {
      label: width < 0.1 ? `£${rangeStart.toFixed(2)}` : `£${rangeStart.toFixed(2)}–${(rangeStart + width).toFixed(2)}`,
      rangeStart,
      qty,
      isFloorBucket: i === floorIdx,
    };
  });

  if (otherQty > 0) {
    buckets.push({ label: 'Other (long tail)', rangeStart: Infinity, qty: otherQty, isFloorBucket: false });
  }

  const totalQty = buckets.reduce((s, b) => s + b.qty, 0);
  return { buckets, totalQty, otherQty };
}

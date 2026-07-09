/**
 * Upgrade a persisted `assessment` JSONB blob to the current StoreAssessment shape.
 *
 * v1 rows (engine_version 1, PR #540) predate the benchmark-field renames
 * (ukSoldAvg→benchmarkAvg, askVsUk→askVsMarket, weightedMedianAskVsUk→…Market),
 * the ageing no-data bucket, the cherry-pick-first verdict signals, and the
 * scan-truncation flag. Rendering reads rows through this shim so old runs keep
 * displaying without a data migration.
 */
import type { StoreAssessment, ScoredLot, Verdict } from './types';

type Raw = Record<string, unknown>;

function upgradeLot(raw: Raw): ScoredLot {
  const lot = raw as unknown as ScoredLot;
  if (lot.benchmarkAvg === undefined) {
    lot.benchmarkAvg = (raw.ukSoldAvg as number | null) ?? null;
    lot.askVsMarket = (raw.askVsUk as number | null) ?? null;
  }
  return lot;
}

function upgradeSignals(raw: Raw): Verdict['signals'] {
  if ('value' in raw) return raw as unknown as Verdict['signals'];
  // v1 shape: { price, margin, coverage, magnet }
  return {
    value: (raw.margin as number) ?? 0,
    efficiency: 0,
    magnet: (raw.magnet as number) ?? 0,
    price: (raw.price as number) ?? 0,
    coverage: (raw.coverage as number) ?? 0,
  };
}

export function normalizeAssessment(rawInput: unknown): StoreAssessment {
  const a = rawInput as StoreAssessment & Raw;
  if (a.engineVersion === undefined) a.engineVersion = 1;
  if (a.scanTruncated === undefined) a.scanTruncated = false;

  const pricing = a.pricing as unknown as Raw;
  if (pricing.weightedMedianAskVsMarket === undefined) {
    a.pricing.weightedMedianAskVsMarket = (pricing.weightedMedianAskVsUk as number | null) ?? null;
  }

  for (const rows of [a.size.biggestLots, a.withinMargin.top, a.highStr.top, a.magnets.top]) {
    rows.forEach((r) => upgradeLot(r as unknown as Raw));
  }

  // v1 ageing counted no-data lots as dead over TOTAL value; keep its numbers as-is
  // but satisfy the new field (v1 denominator was effectively "everything").
  if ((a.ageing as unknown as Raw).benchmarkedValueShare === undefined) {
    a.ageing.benchmarkedValueShare = 1;
  }

  a.verdict.signals = upgradeSignals(a.verdict.signals as unknown as Raw);

  // v1/v2 rows predate overlap tagging (engine v3) — synthesize an unavailable section.
  if (a.overlap === undefined) {
    a.overlap = {
      available: false, snapshotAt: null, salesWindowDays: null,
      buyableTags: [], untaggedBuyableLots: a.withinMargin?.lots ?? 0, freshNetShare: null,
    };
  }

  return a;
}

/**
 * bl-store-report — compute. Adapts either lens (assessment ScoredLots or
 * bl-basket enriched items) into the common DecisionReport, applying the
 * demand cap, ceiling signal, gate ladder and liquid headline.
 */
import type { StoreAssessment, ScoredLot } from '../bl-store-assessment/types';
import { captureFraction } from '../bricklink/liquidity-pov';
import {
  DEFAULT_INBOUND_POSTAGE_GBP, LIQUID_STR_GATE, STR_GATES, VAR_FEE_PCT,
} from '../bricklink/fees';
import type {
  BuildOptions, DecisionReport, DecisionRow, DecisionSummary, GateCol,
} from './types';

const round = (n: number, dp = 2): number => Math.round(n * 10 ** dp) / 10 ** dp;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Share of sold qty at/above list below which a lot gets the ceiling warning. */
export const CEILING_WARN_SHARE = 0.2;
/** moCover display/median cap — beyond this the lot is effectively dead-slow. */
const MO_COVER_CAP = 36;

function medianOrNull(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Demand cap: units we can realistically clear in the 6-mo window. */
export function cappedUnits(qty: number, marketSoldQty6mo: number | null, strQty: number | null): number | null {
  if (marketSoldQty6mo == null) return null; // no benchmark — no cap opinion
  return Math.min(qty, Math.ceil(marketSoldQty6mo * captureFraction(strQty)));
}

export function fromScoredLot(s: ScoredLot): DecisionRow {
  const sold = s.marketSoldQty6mo ?? null;
  const capQty = cappedUnits(s.invQty, sold, s.strQty);
  return {
    itemType: s.itemType,
    itemNo: s.itemNo,
    colourName: s.colourName,
    itemName: s.itemName,
    condition: s.condition,
    qty: s.invQty,
    ask: s.ask,
    benchmark: s.benchmarkAvg,
    benchProvenance: s.priceSource === 'uk' ? 'uk' : s.priceSource === 'world' ? 'world' : 'none',
    strQty: s.strQty,
    list: s.ourList,
    netPerUnit: s.netPerUnit,
    marginPct: s.marginPct,
    lotNet: s.lotProfit,
    marketSoldQty6mo: sold,
    cappedQty: capQty,
    cappedLotNet: s.netPerUnit == null ? null : round(s.netPerUnit * (capQty ?? s.invQty)),
    moCover: sold != null && sold > 0 ? round(Math.min(MO_COVER_CAP, s.invQty / (sold / 6)), 1) : null,
    ceilingShare: s.soldShareAtList ?? null,
    overlap: s.overlap,
    worldSupplyLots: s.worldSupplyLots,
    magnet: s.magnet,
    highStr: s.highStr,
    withinMargin: s.withinMargin,
    damage: s.damageNote,
  };
}

/** Minimal shape the bl-basket lens supplies (subset of its EnrichedItem). */
export interface BasketLensItem {
  itemType: 'P' | 'S' | 'M';
  itemNo: string;
  colourName: string | null;
  itemName: string;
  condition: 'N' | 'U';
  invQty: number;
  unitPriceGBP: number;
  ukSoldAvg: number | null;
  ukSoldQty: number;
  ukStockQty: number;
  sellThru: number;
  listPrice: number | null;
  /** bl-basket nets include a proportional postage share — pass it so we can strip it. */
  netPerUnit: number | null;
  inboundPerUnit: number | null;
  marginPct: number | null; // percentage points (bl-basket convention)
  passed: boolean;
  damage?: boolean;
}

export function fromBasketItem(it: BasketLensItem): DecisionRow {
  // Normalise to the common convention: per-lot net EX-POSTAGE (the selection pays
  // the full inbound postage once, in the summary).
  const netExPostage = it.netPerUnit == null ? null : it.netPerUnit + (it.inboundPerUnit ?? 0);
  const sold = it.ukSoldAvg == null ? null : it.ukSoldQty;
  const capQty = cappedUnits(it.invQty, sold, it.sellThru);
  return {
    itemType: it.itemType,
    itemNo: it.itemNo,
    colourName: it.colourName,
    itemName: it.itemName,
    condition: it.condition,
    qty: it.invQty,
    ask: it.unitPriceGBP,
    benchmark: it.ukSoldAvg,
    benchProvenance: it.ukSoldAvg == null ? 'none' : 'uk',
    strQty: it.sellThru,
    list: it.listPrice,
    netPerUnit: netExPostage == null ? null : round(netExPostage, 4),
    marginPct: it.marginPct == null ? null : round(it.marginPct / 100, 4),
    lotNet: netExPostage == null ? null : round(netExPostage * it.invQty),
    marketSoldQty6mo: sold,
    cappedQty: capQty,
    cappedLotNet: netExPostage == null ? null : round(netExPostage * (capQty ?? it.invQty)),
    moCover: sold != null && sold > 0 ? round(Math.min(MO_COVER_CAP, it.invQty / (sold / 6)), 1) : null,
    ceilingShare: null, // basket lens has no histogram in its price map
    overlap: null, // basket lens has no overlap index
    worldSupplyLots: null,
    magnet: false,
    highStr: false,
    withinMargin: it.passed,
    damage: it.damage ?? false,
  };
}

function buildGates(buyRows: DecisionRow[], inboundPostage: number): GateCol[] {
  return STR_GATES.map((gate) => {
    const sel = buyRows.filter((r) => (r.strQty ?? 0) >= gate);
    const outlay = sum(sel.map((r) => r.ask * r.qty));
    const listValue = sum(sel.map((r) => (r.list ?? 0) * r.qty));
    const raw = sum(sel.map((r) => r.lotNet ?? 0));
    const capped = sum(sel.map((r) => r.cappedLotNet ?? 0));
    const dups = sel.filter((r) => r.overlap === 'DUPLICATE');
    const cappedNoDups = capped - sum(dups.map((r) => r.cappedLotNet ?? 0));
    const addl = sel.filter((r) => r.overlap === 'NEW' || r.overlap === 'RESTOCK_OUT');
    const post = sel.length ? inboundPostage : 0;
    return {
      gate,
      lots: sel.length,
      outlay: round(outlay),
      rawNet: round(raw - post),
      cappedNet: round(capped - post),
      cappedNetNoDups: round(cappedNoDups - post),
      dupLots: dups.length,
      marginPct: listValue > 0 ? round((raw - post) / listValue, 4) : null,
      roiPct: outlay > 0 ? round((capped - post) / outlay, 4) : null,
      medianStr: medianOrNull(sel.map((r) => r.strQty ?? 0)),
      medianMoCover: medianOrNull(sel.map((r) => r.moCover ?? MO_COVER_CAP)),
      addlLots: addl.length,
      addlCappedNet: round(sum(addl.map((r) => r.cappedLotNet ?? 0)) - (addl.length ? inboundPostage : 0)),
    };
  });
}

export function buildSummary(allPmRows: DecisionRow[], buyRows: DecisionRow[], inboundPostage: number, setLotsExcluded: number): DecisionSummary {
  const outlay = sum(buyRows.map((r) => r.ask * r.qty));
  const listValue = sum(buyRows.map((r) => (r.list ?? 0) * r.qty));
  const rawNet = sum(buyRows.map((r) => r.lotNet ?? 0)) - (buyRows.length ? inboundPostage : 0);
  const cappedNet = sum(buyRows.map((r) => r.cappedLotNet ?? 0)) - (buyRows.length ? inboundPostage : 0);
  const liquid = buyRows.filter((r) => (r.strQty ?? 0) >= LIQUID_STR_GATE && r.overlap !== 'DUPLICATE');
  const liquidOutlay = sum(liquid.map((r) => r.ask * r.qty));
  const liquidNet = sum(liquid.map((r) => r.cappedLotNet ?? 0)) - (liquid.length ? inboundPostage : 0);
  const strs = buyRows.map((r) => r.strQty ?? 0);
  const strOutlayW = outlay > 0
    ? sum(buyRows.map((r) => (r.strQty ?? 0) * r.ask * r.qty)) / outlay
    : null;
  return {
    lots: buyRows.length,
    pieces: sum(buyRows.map((r) => r.qty)),
    outlay: round(outlay),
    listValue: round(listValue),
    inboundPostage,
    rawNet: round(rawNet),
    cappedNet: round(cappedNet),
    liquidNet: round(liquidNet),
    liquidGate: LIQUID_STR_GATE,
    liquidLots: liquid.length,
    liquidOutlay: round(liquidOutlay),
    strMedian: medianOrNull(strs),
    strMean: strs.length ? round(sum(strs) / strs.length, 3) : null,
    strOutlayWeighted: strOutlayW == null ? null : round(strOutlayW, 3),
    coverage: {
      totalLots: allPmRows.length,
      ukLots: allPmRows.filter((r) => r.benchProvenance === 'uk').length,
      worldLots: allPmRows.filter((r) => r.benchProvenance === 'world').length,
      noneLots: allPmRows.filter((r) => r.benchProvenance === 'none').length,
    },
    magnetLots: buyRows.filter((r) => r.magnet).length,
    highStrLots: buyRows.filter((r) => r.highStr).length,
    dupLots: buyRows.filter((r) => r.overlap === 'DUPLICATE').length,
    ceilingWarnLots: buyRows.filter((r) => r.ceilingShare != null && r.ceilingShare < CEILING_WARN_SHARE).length,
    setLotsExcluded,
    gates: buildGates(buyRows, inboundPostage),
  };
}

function applyViewFilters(rows: DecisionRow[], opts: BuildOptions): DecisionRow[] {
  let out = rows;
  if (opts.minStr != null) out = out.filter((r) => (r.strQty ?? 0) >= opts.minStr!);
  if (opts.magnetsOnly) out = out.filter((r) => r.magnet);
  if (opts.excludeDups) out = out.filter((r) => r.overlap !== 'DUPLICATE');
  return out;
}

/**
 * Build the common decision report from a StoreAssessment. Pass the full
 * `scoredLots` (from `assembleAssessmentWithLots` / the offline recompute) for a
 * complete table; without them the rows come from the persisted section top-N
 * union — flagged `partialRows`, coverage taken from the assessment's own
 * strCoverage counts so the split stays honest.
 */
export function buildDecisionReport(a: StoreAssessment, opts: BuildOptions = {}, scoredLots?: ScoredLot[]): DecisionReport {
  const inbound = opts.inboundPostage ?? DEFAULT_INBOUND_POSTAGE_GBP;
  const partialRows = scoredLots == null;
  // P/M scope — the bl-basket cart universe. Sets are a separate decision.
  const allPm = (scoredLots ?? collectScoredLots(a)).filter((s) => s.itemType !== 'S');
  const allPmRows = allPm.map(fromScoredLot);
  const buyRows = applyViewFilters(allPmRows.filter((r) => r.withinMargin), opts)
    .sort((x, y) => (y.cappedLotNet ?? 0) - (x.cappedLotNet ?? 0));
  const setLots = a.size.byType.find((b) => b.key === 'Sets')?.lots ?? 0;
  const summary = buildSummary(allPmRows, buyRows, inbound, setLots);
  // Persisted top-N fallback can't see every lot — take the true provenance split
  // from the assessment's own coverage counts.
  if (partialRows && a.strCoverage) {
    summary.coverage = { ...a.strCoverage.coverage };
  }
  return {
    meta: {
      lens: 'assess',
      partialRows,
      slug: a.store.slug,
      storeName: a.store.storeName,
      country: a.store.country,
      scannedAt: a.scannedAt,
      generatedAt: new Date().toISOString(),
      engineVersion: a.engineVersion ?? null,
      scanTruncated: a.scanTruncated,
      inputs: {
        feePct: a.inputs.feeModel.blFee + a.inputs.feeModel.bricqerFee + a.inputs.feeModel.paypalPct,
        minMargin: a.inputs.minMargin,
        minStr: a.inputs.minStr,
        inboundPostage: inbound,
      },
      ukGroundedOnly: a.inputs.ukGroundedOnly ?? null,
    },
    rows: buyRows,
    summary,
  };
}

/**
 * The persisted assessment stores lots only inside its section top-N lists — the
 * FULL scored set isn't on the jsonb. Union the section lists (deduped by invID)
 * so a report built from an old persisted row still renders honestly; reports
 * built from a fresh in-memory run (or the CLI's offline recompute) pass the full
 * scored set via `scoredLots` on the assessment object instead.
 */
function collectScoredLots(a: StoreAssessment): ScoredLot[] {
  const seen = new Map<number, ScoredLot>();
  const pools: (ScoredLot[] | undefined)[] = [
    a.withinMargin?.top, a.highStr?.top, a.magnets?.top, a.size?.biggestLots,
  ];
  for (const pool of pools) for (const s of pool ?? []) if (!seen.has(s.invID)) seen.set(s.invID, s);
  return [...seen.values()];
}

/** Build the common decision report from bl-basket lens items. */
export function buildBasketDecisionReport(
  items: BasketLensItem[],
  meta: { slug: string; storeName: string | null; country: string | null; inputs: { minMargin: number; minStr: number; shipping: number } },
): DecisionReport {
  const inbound = meta.inputs.shipping;
  const pm = items.filter((i) => i.itemType !== 'S');
  const allPmRows = pm.map(fromBasketItem);
  const buyRows = allPmRows.filter((r) => r.withinMargin)
    .sort((x, y) => (y.cappedLotNet ?? 0) - (x.cappedLotNet ?? 0));
  return {
    meta: {
      lens: 'basket',
      slug: meta.slug,
      storeName: meta.storeName,
      country: meta.country,
      scannedAt: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      engineVersion: null,
      scanTruncated: false,
      inputs: { feePct: VAR_FEE_PCT, minMargin: meta.inputs.minMargin, minStr: meta.inputs.minStr, inboundPostage: inbound },
      ukGroundedOnly: true, // bl-basket enriches UK-only via the live-check path
    },
    rows: buyRows,
    summary: buildSummary(allPmRows, buyRows, inbound, items.length - pm.length),
  };
}

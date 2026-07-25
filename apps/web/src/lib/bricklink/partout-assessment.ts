/**
 * Part-out assessment — the canonical decision layer for a single set.
 *
 * The Partout tab used to render a bare `POV > set price` boolean on GROSS value:
 * no fees, no liquidity haircut, no bands. Meanwhile the store-assessment engine,
 * bl-basket and bl-store-report had all standardised on a much sharper model. This
 * module is that model applied to one set, so a set looked up here and the same set
 * seen in a store assessment reconcile.
 *
 * Everything here is pure — no I/O. Supply and overlap are resolved upstream (in
 * PartoutService, which holds the Supabase client) and arrive on `PartValue`.
 *
 * NOTHING in this file declares a threshold. Fees, STR gates, the magnet definition
 * and the part-out gate all come from `./fees`; the capture curve comes from
 * `./liquidity-pov`. That is deliberate — the 2026-07-19 audit was caused by exactly
 * this kind of module re-deriving its own constants.
 */

import {
  VAR_FEE_PCT,
  STR_GATES,
  UK_MAGNET,
  POV_MULTIPLE_MIN,
  POV_MIN_GAP_GBP,
  DEFAULT_MIN_MARGIN,
  DEFAULT_INBOUND_POSTAGE_GBP,
} from './fees';
import { liquidityAdjustedPov, captureFraction, type PovLot } from './liquidity-pov';
import type {
  PartValue,
  PartoutAssessment,
  PartoutCondition,
  PartoutStrBand,
  PartoutMagnet,
  PartoutConcentration,
  PartoutOverlapSummary,
} from '@/types/partout';
import type { OverlapTag } from '@/lib/bl-store-assessment/overlap';

/** How many lots the "where the value sits" panel lists. */
const TOP_LOTS = 10;

/** Percent label for verdict copy, without trailing zeros ("20%", "9.4%"). */
const pctLabel = (v: number): string => `${Number((v * 100).toFixed(1))}%`;

const round = (v: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

/** Per-condition accessors so the whole module works off one shape. */
interface Lens {
  price: (p: PartValue) => number | null;
  /** QUANTITY-basis STR fraction — the house standard. Never the lots-basis ×100. */
  str: (p: PartValue) => number | null;
  ukStockQty: (p: PartValue) => number | null;
  worldSupplyLots: (p: PartValue) => number | null;
  overlap: (p: PartValue) => OverlapTag | null;
}

const LENSES: Record<PartoutCondition, Lens> = {
  new: {
    price: (p) => p.priceNew,
    str: (p) => p.strQtyNew,
    ukStockQty: (p) => p.stockAvailableNew,
    worldSupplyLots: (p) => p.worldSupplyLotsNew,
    overlap: (p) => p.overlapNew,
  },
  used: {
    price: (p) => p.priceUsed,
    str: (p) => p.strQtyUsed,
    ukStockQty: (p) => p.stockAvailableUsed,
    worldSupplyLots: (p) => p.worldSupplyLotsUsed,
    overlap: (p) => p.overlapUsed,
  },
};

const lineGross = (p: PartValue, lens: Lens): number => {
  const price = lens.price(p);
  return price == null || !Number.isFinite(price) ? 0 : price * p.quantity;
};

/**
 * STR band ladder — inclusive gates ("lots at STR ≥ g"), matching the store-report
 * gate ladder so the two read the same way.
 *
 * Unpriced lots are excluded: they carry no value to band, and counting them would
 * make the shares not sum to the POV.
 */
function buildStrBands(parts: PartValue[], lens: Lens, grossPov: number): PartoutStrBand[] {
  return STR_GATES.map((gate) => {
    let lots = 0;
    let qty = 0;
    let grossValue = 0;
    let realisableValue = 0;

    for (const p of parts) {
      const price = lens.price(p);
      if (price == null || !Number.isFinite(price)) continue;
      const str = lens.str(p);
      // A null STR cannot be shown to clear a positive gate. It still lands in the
      // gate-0 bucket, which is what "≥ 0" honestly means.
      if (gate > 0 && (str == null || str < gate)) continue;
      const value = price * p.quantity;
      lots += 1;
      qty += p.quantity;
      grossValue += value;
      realisableValue += value * captureFraction(str);
    }

    return {
      gate,
      lots,
      qty,
      grossValue: round(grossValue),
      realisableValue: round(realisableValue),
      shareOfPov: grossPov > 0 ? round(grossValue / grossPov, 4) : 0,
    };
  });
}

/**
 * Magnets: thinly supplied IN THE UK and actually selling.
 *
 * Scarcity is UK stock QUANTITY (pieces), cut separately for parts and minifigs (see UK_MAGNET) —
 * their supply distributions aren't comparable, so one gate across both is really two
 * different levels of strictness wearing the same number. The minifig bound is the
 * TIGHTER one because figures sit thinner on the shelf to begin with.
 *
 * The `> 0` guard is kept: a zero UK stock count is ambiguous (nothing listed, or nothing
 * captured), and treating it as infinite scarcity would flag every gap in the cache. That
 * does cost us the genuinely-strongest case — zero listed with sales on record — which is
 * a known limitation rather than an oversight.
 *
 * Surfaced independently of the set-level verdict: a set that fails the part-out gate can
 * still be worth buying for its magnet content.
 */
function findMagnets(parts: PartValue[], lens: Lens): PartoutMagnet[] {
  const out: PartoutMagnet[] = [];

  for (const p of parts) {
    const gate = p.partType === 'MINIFIG' ? UK_MAGNET.minifig : UK_MAGNET.part;
    const str = lens.str(p);
    const ukQty = lens.ukStockQty(p);
    // Both bounds exclusive, per the spec: "figs < 5 or parts < 10 and STR > 1",
    // measured in PIECES.
    const isMagnet =
      str != null &&
      str > gate.strAbove &&
      ukQty != null &&
      ukQty > 0 &&
      ukQty < gate.ukStockQtyUnder;
    if (!isMagnet) continue;

    const price = lens.price(p);
    out.push({
      partNumber: p.partNumber,
      partType: p.partType,
      name: p.name,
      colourId: p.colourId,
      colourName: p.colourName,
      imageUrl: p.imageUrl,
      quantity: p.quantity,
      price,
      str,
      ukStockQty: ukQty,
      worldSupplyLots: lens.worldSupplyLots(p),
      lineValue: round(lineGross(p, lens)),
      overlap: lens.overlap(p),
    });
  }

  // Scarcest in the UK first, then best sell-through.
  return out.sort(
    (a, b) => (a.ukStockQty ?? 99) - (b.ukStockQty ?? 99) || (b.str ?? 0) - (a.str ?? 0)
  );
}

/** Where the value sits: top lots, concentration, and the minifig/part split. */
function buildConcentration(
  parts: PartValue[],
  lens: Lens,
  grossPov: number
): PartoutConcentration {
  const valued = parts
    .map((p) => ({ part: p, value: lineGross(p, lens) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const topLots = valued.slice(0, TOP_LOTS).map(({ part, value }) => ({
    partNumber: part.partNumber,
    partType: part.partType,
    name: part.name,
    colourId: part.colourId,
    colourName: part.colourName,
    imageUrl: part.imageUrl,
    quantity: part.quantity,
    lineValue: round(value),
    shareOfPov: grossPov > 0 ? round(value / grossPov, 4) : 0,
  }));

  const top10Share =
    grossPov > 0
      ? round(valued.slice(0, TOP_LOTS).reduce((s, r) => s + r.value, 0) / grossPov, 4)
      : 0;

  // How few lots carry half the money — the blunt concentration read.
  let running = 0;
  let lotsToHalfPov = 0;
  for (const r of valued) {
    if (running >= grossPov / 2) break;
    running += r.value;
    lotsToHalfPov += 1;
  }

  const byType = { minifig: 0, part: 0, other: 0 };
  for (const { part, value } of valued) {
    if (part.partType === 'MINIFIG') byType.minifig += value;
    else if (part.partType === 'PART') byType.part += value;
    else byType.other += value;
  }

  return {
    topLots,
    top10Share,
    lotsToHalfPov,
    byType: {
      minifig: round(byType.minifig),
      part: round(byType.part),
      other: round(byType.other),
    },
  };
}

/**
 * Headline sell-through across priced lots.
 *
 * Median first: STR is skewed by design — one seller sitting on a 500-piece lot, or one
 * bulk clear-out, moves the mean a long way from what a typical lot does. Both are
 * reported so the gap between them is visible, because that gap IS the signal.
 * Lots with no STR data are excluded rather than counted as zero.
 */
function buildStrSummary(
  parts: PartValue[],
  lens: Lens
): { median: number | null; mean: number | null; lotsWithStr: number } {
  const values = parts
    .filter((p) => {
      const price = lens.price(p);
      return price != null && Number.isFinite(price);
    })
    .map((p) => lens.str(p))
    .filter((v): v is number => v != null && Number.isFinite(v))
    .sort((a, b) => a - b);

  if (values.length === 0) return { median: null, mean: null, lotsWithStr: 0 };

  const mid = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
  const mean = values.reduce((s, v) => s + v, 0) / values.length;

  return { median: round(median, 3), mean: round(mean, 3), lotsWithStr: values.length };
}

/** Roll the per-lot overlap tags into a set-level summary. Null when no index ran. */
function buildOverlap(
  parts: PartValue[],
  lens: Lens,
  meta: { snapshotAt: string | null; salesWindowDays: number } | null
): PartoutOverlapSummary | null {
  if (!meta) return null;

  const counts = { NEW: 0, RESTOCK_OUT: 0, RESTOCK_THIN: 0, DUPLICATE: 0 };
  let additionalValue = 0;
  let duplicateValue = 0;

  for (const p of parts) {
    const tag = lens.overlap(p);
    if (!tag) continue;
    counts[tag] += 1;
    const value = lineGross(p, lens);
    // NEW + RESTOCK_OUT are lots this set would ADD to the store. RESTOCK_THIN is
    // depth on something we already list, so it is neither additional nor a dup.
    if (tag === 'NEW' || tag === 'RESTOCK_OUT') additionalValue += value;
    else if (tag === 'DUPLICATE') duplicateValue += value;
  }

  return {
    snapshotAt: meta.snapshotAt,
    salesWindowDays: meta.salesWindowDays,
    counts,
    additionalValue: round(additionalValue),
    duplicateValue: round(duplicateValue),
  };
}

export interface AssessPartoutOptions {
  /** Target net margin for the max-buy back-solve. Defaults to DEFAULT_MIN_MARGIN. */
  targetMargin?: number;
  /**
   * Inbound postage to get the set to the bench, as a cash cost off the max buy.
   * Defaults to DEFAULT_INBOUND_POSTAGE_GBP (£3). Pass 0 for a local collection.
   */
  inboundPostageGbp?: number;
  /** Overlap index metadata; omit/null when no Bricqer snapshot was loaded. */
  overlapMeta?: { snapshotAt: string | null; salesWindowDays: number } | null;
}

/**
 * Assess a set's part-out prospects for one condition.
 *
 * @param parts   The set's lots, already enriched with price, qty-basis STR,
 *                worldwide supply and overlap tags.
 * @param setPrice Complete-set price for this condition — the gate's ask basis.
 * @param condition Which condition lens to apply.
 */
export function assessPartout(
  parts: PartValue[],
  setPrice: number | null,
  condition: PartoutCondition,
  options: AssessPartoutOptions = {}
): PartoutAssessment {
  const lens = LENSES[condition];
  const targetMargin = options.targetMargin ?? DEFAULT_MIN_MARGIN;
  const postageGbp = options.inboundPostageGbp ?? DEFAULT_INBOUND_POSTAGE_GBP;

  const lots: PovLot[] = parts.map((p) => ({
    qty: p.quantity,
    price: lens.price(p),
    str: lens.str(p),
  }));
  const { gross, realisable, captureRate } = liquidityAdjustedPov(lots);

  // Net is taken off the FULL part-out value, not the liquidity-adjusted one (Chris,
  // 2026-07-25: "I want the decision based on the full part out value and this calc just
  // an FYI"). Rationale: the capture curve is still uncalibrated, so letting an unfitted
  // model move the money figures imports its error into every decision — and the gate
  // already runs on gross, so this makes the two consistent. The liquidity view stays on
  // the assessment as `realisablePov` / `captureRate`, surfaced as an explained FYI.
  const netPov = gross * (1 - VAR_FEE_PCT);

  const povMultiple = setPrice && setPrice > 0 ? gross / setPrice : null;
  const gapGbp = setPrice != null ? gross - setPrice : null;

  // The canonical gate, identical to bl-store-assessment's SETS section. Applied on
  // GROSS vs ask so the two surfaces agree; the realisable/net figures sit alongside
  // it rather than moving the gate.
  const gatePasses =
    povMultiple != null &&
    gapGbp != null &&
    povMultiple >= POV_MULTIPLE_MIN &&
    gapGbp >= POV_MIN_GAP_GBP;

  // Max buy, in the same reverse-calc form as purchase-evaluator:
  //   revenue − fees − target profit, where target profit = revenue × margin.
  // Revenue is the FULL part-out value. The target margin is what absorbs the risk that
  // not every lot clears — see the note on netPov above.
  //
  // Teardown labour is NOT deducted here. It is already expressed in the 2× POV gate and
  // the target margin (Chris, 2026-07-25: "labour is baked into the POV ×, that is the
  // margin where the time input makes sense"), so a separate line would double-count it.
  // Inbound postage then comes off as a flat cash cost, paid on top of the purchase price.
  const beforePostage = gross > 0 ? gross * (1 - VAR_FEE_PCT - targetMargin) : null;
  const maxBuyPrice = beforePostage == null ? null : beforePostage - postageGbp;
  // Not clamped at zero: a negative ceiling IS the answer for a thin set.
  const viable = maxBuyPrice != null && maxBuyPrice > 0;

  let verdict: PartoutAssessment['verdict'];
  let verdictReason: string;
  const hasSetPrice = setPrice != null && setPrice > 0;

  if (gross <= 0) {
    verdict = 'SKIP';
    verdictReason = 'No UK price data for this set’s parts — nothing to value.';
  } else if (hasSetPrice) {
    // A complete-set price exists, so the PRIORITY question is answerable and it is the
    // more useful headline: it says which ROUTE to take. A negative max buy alongside it
    // is not a contradiction — "part this one out rather than sell it whole" and "don't
    // buy another to part out" are different statements — and the max-buy card carries
    // that second message in red.
    if (gatePasses) {
      verdict = 'PART-OUT';
      verdictReason = `POV is ${povMultiple!.toFixed(2)}× the set price (gate ${POV_MULTIPLE_MIN}×) with a £${gapGbp!.toFixed(2)} gap (gate £${POV_MIN_GAP_GBP}).`;
    } else {
      verdict = 'SELL-COMPLETE';
      const failedMultiple = povMultiple! < POV_MULTIPLE_MIN;
      verdictReason = failedMultiple
        ? `POV is only ${povMultiple!.toFixed(2)}× the set price — below the ${POV_MULTIPLE_MIN}× gate, so parting out isn’t worth the bench time.`
        : `POV clears ${POV_MULTIPLE_MIN}× but the £${gapGbp!.toFixed(2)} gap is under the £${POV_MIN_GAP_GBP} labour floor.`;
    }
  } else if (viable) {
    // No complete-set price, so there is no route comparison to make — but the
    // ACQUISITION question stands on its own, and it is the actionable half.
    verdict = 'PART-OUT-BELOW';
    verdictReason = `No complete-set price on record, so there’s no sell-complete comparison. The part-out stands on its own: worth doing if you can buy under £${maxBuyPrice!.toFixed(2)}.`;
  } else {
    // The negative counterpart of PART-OUT-BELOW. Stronger and more useful than the old
    // "insufficient data", which withheld an answer we already had.
    verdict = 'NOT-VIABLE';
    verdictReason = `Even at £0 the part-out doesn’t clear ${pctLabel(targetMargin)} after ${pctLabel(VAR_FEE_PCT)} fees and £${postageGbp.toFixed(2)} postage — not worth it at any purchase price.`;
  }

  const pricedLots = parts.filter((p) => {
    const price = lens.price(p);
    return price != null && Number.isFinite(price) && price > 0;
  }).length;

  return {
    condition,
    grossPov: round(gross),
    realisablePov: round(realisable),
    captureRate: round(captureRate, 4),
    netPov: round(netPov),
    feePct: VAR_FEE_PCT,
    setPrice: setPrice == null ? null : round(setPrice),
    povMultiple: povMultiple == null ? null : round(povMultiple, 2),
    gapGbp: gapGbp == null ? null : round(gapGbp),
    verdict,
    verdictReason,
    gate: { povMultipleMin: POV_MULTIPLE_MIN, minGapGbp: POV_MIN_GAP_GBP },
    maxBuy: {
      targetMargin,
      postageGbp,
      beforePostage: beforePostage == null ? null : round(beforePostage),
      price: maxBuyPrice == null ? null : round(maxBuyPrice),
    },
    strSummary: buildStrSummary(parts, lens),
    strBands: buildStrBands(parts, lens, gross),
    magnets: findMagnets(parts, lens),
    concentration: buildConcentration(parts, lens, gross),
    overlap: buildOverlap(parts, lens, options.overlapMeta ?? null),
    pricedLots,
    unpricedLots: parts.length - pricedLots,
    // The magnet test's denominator. `readSupplySafely` swallows failures and returns an
    // empty map, so without this an outage reads on screen as "no magnets" — a positive
    // claim built on absent evidence.
    magnetCoverage: {
      withSupplyData: parts.filter((p) => lens.ukStockQty(p) != null).length,
      total: parts.length,
    },
  };
}

/** Assess both conditions in one pass. */
export function assessPartoutBoth(
  parts: PartValue[],
  setPrice: { new: number | null; used: number | null },
  options: AssessPartoutOptions = {}
): { new: PartoutAssessment; used: PartoutAssessment } {
  return {
    new: assessPartout(parts, setPrice.new, 'new', options),
    used: assessPartout(parts, setPrice.used, 'used', options),
  };
}

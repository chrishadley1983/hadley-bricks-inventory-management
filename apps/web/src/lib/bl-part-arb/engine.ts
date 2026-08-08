/**
 * Part-first arbitrage — pure engine.
 *
 * Three seams, all network-free and unit-tested:
 *   1. anchorsFromCacheRow — screen one price-guide-cache row into 0-2 anchors
 *      (one per condition) using the UK stock histogram for depth.
 *   2. nominateStores — join anchors against flattened store lots to find which
 *      stores hold the cheap units.
 *   3. scoreStoreLots — score a nominated store's full cached inventory into
 *      BasketLensItems for the common bl-store-report decision module.
 *
 * All constants come from fees.ts / bricqer-pricing; nothing is re-declared.
 */

import { DEFAULT_MIN_MARGIN, VAR_FEE_PCT } from '../bricklink/fees';
import { bricqerListPrice } from '../bricklink/bricqer-pricing';
import { computeBoilerplate, hasDamageNote } from '../bl-store-assessment/engine';
import { pgKey, ukSideFromCacheRow, type PriceGuideView, type SideView } from '../bricklink/price-guide/read';
import type { StoreLot } from '../bl-store-assessment/types';
import type { WantedSourceLot } from '../bricklink/wanted-list';
import type { BasketLensItem } from '../bl-store-report/compute';
import type { AnchorHit, AnchorTuple, FlatStoreLot, PartArbInputs, StoreNomination } from './types';

export const DEFAULT_PART_ARB_INPUTS: PartArbInputs = {
  minStrLots: 1.0,
  minSoldQty: 10,
  minAsk: 0.10,
  minMargin: DEFAULT_MIN_MARGIN,
  minStr: 0,
  shipping: 3.0, // DEFAULT_INBOUND_POSTAGE_GBP — kept in sync via test
  minUnitsBuyable: 1,
};

/**
 * Highest ask that still clears `minMargin` of list after the variable fee stack,
 * ex-postage (the summary charges inbound postage once, whole — the standalone rule):
 *   net = list x (1 - VAR_FEE_PCT) - ask  >=  list x minMargin
 */
export function maxViableAsk(listPrice: number, minMargin: number): number {
  return listPrice * (1 - VAR_FEE_PCT - minMargin);
}

/**
 * Units in a price->qty histogram priced within [minAsk, maxAsk]. The rolled-up
 * "other" bucket has no known price and is never counted (conservative lower bound,
 * same stance as qtyShareAtOrAbove).
 */
export function unitsWithin(
  hist: Record<string, number> | undefined,
  minAsk: number,
  maxAsk: number
): number {
  if (!hist) return 0;
  let units = 0;
  for (const [price, qty] of Object.entries(hist)) {
    const p = Number(price);
    if (!Number.isFinite(p) || !qty) continue; // "other" bucket / junk keys
    if (p >= minAsk && p <= maxAsk) units += qty;
  }
  return units;
}

/** Screen one condition side into an anchor, or null if any gate fails. */
export function anchorFromSide(
  item: { itemType: 'P' | 'M'; itemNo: string; colourId: number; itemName: string | null },
  condition: 'N' | 'U',
  side: SideView,
  inputs: PartArbInputs
): AnchorTuple | null {
  if (side.strLots == null || side.strLots < inputs.minStrLots) return null;
  if (side.soldQty < inputs.minSoldQty) return null;
  const listPrice = bricqerListPrice(side.soldAvg, condition, side.strQty ?? 0);
  if (listPrice == null) return null;
  const ceiling = maxViableAsk(listPrice, inputs.minMargin);
  if (ceiling < inputs.minAsk) return null; // margin unreachable at any allowed ask
  const unitsBuyable = unitsWithin(side.stockHist, inputs.minAsk, ceiling);
  if (unitsBuyable < inputs.minUnitsBuyable) return null;
  return {
    ...item,
    condition,
    soldAvg: side.soldAvg as number,
    soldQty: side.soldQty,
    soldLots: side.soldLots,
    stockLots: side.stockLots,
    stockQty: side.stockQty,
    strLots: side.strLots,
    strQty: side.strQty,
    listPrice,
    maxViableAsk: ceiling,
    unitsBuyable,
    stockMin: side.stockMin,
  };
}

/**
 * Screen one raw bricklink_price_guide_cache row (P/M) into 0-2 anchors.
 * Parsing goes through ukSideFromCacheRow — the same parser readPriceGuide uses.
 */
export function anchorsFromCacheRow(row: Record<string, unknown>, inputs: PartArbInputs): AnchorTuple[] {
  const itemType = String(row.item_type) as 'P' | 'M';
  if (itemType !== 'P' && itemType !== 'M') return [];
  const item = {
    itemType,
    itemNo: String(row.item_no),
    colourId: Number(row.colour_id ?? 0),
    itemName: (row.item_name as string | null) ?? null,
  };
  const out: AnchorTuple[] = [];
  const newAnchor = anchorFromSide(item, 'N', ukSideFromCacheRow(row, 'new'), inputs);
  if (newAnchor) out.push(newAnchor);
  const usedAnchor = anchorFromSide(item, 'U', ukSideFromCacheRow(row, 'used'), inputs);
  if (usedAnchor) out.push(usedAnchor);
  return out;
}

const anchorKey = (t: { itemType: string; itemNo: string; colourId: number; condition: string }): string =>
  `${t.itemType}:${t.itemNo}:${t.colourId}:${t.condition}`;

/**
 * Join anchors against flattened store lots: a hit is a store lot of the same
 * (type, no, colour, condition) asking within [minAsk, maxViableAsk]. Returns
 * nominations sorted by anchor net (uncapped, ex-postage — ranking signal only).
 */
export function nominateStores(
  anchors: AnchorTuple[],
  storeLots: FlatStoreLot[],
  inputs: PartArbInputs
): StoreNomination[] {
  const byKey = new Map<string, AnchorTuple>();
  for (const a of anchors) byKey.set(anchorKey(a), a);
  const byStore = new Map<string, AnchorHit[]>();
  for (const lot of storeLots) {
    if (lot.inv_qty <= 0) continue;
    const anchor = byKey.get(
      anchorKey({ itemType: lot.item_type, itemNo: lot.item_no, colourId: lot.colour_id, condition: lot.condition })
    );
    if (!anchor) continue;
    const ask = Number(lot.unit_price_gbp);
    if (!(ask >= inputs.minAsk && ask <= anchor.maxViableAsk)) continue;
    const hit: AnchorHit = {
      anchor,
      storeSlug: lot.store_slug,
      invId: lot.inv_id,
      ask,
      qty: lot.inv_qty,
      netPerUnit: anchor.listPrice * (1 - VAR_FEE_PCT) - ask,
      scannedAt: lot.scanned_at,
    };
    const list = byStore.get(lot.store_slug);
    if (list) list.push(hit);
    else byStore.set(lot.store_slug, [hit]);
  }
  const nominations: StoreNomination[] = [...byStore.entries()].map(([storeSlug, hits]) => ({
    storeSlug,
    hits: hits.sort((a, b) => b.netPerUnit * b.qty - a.netPerUnit * a.qty),
    anchorNetExPostage: hits.reduce((s, h) => s + h.netPerUnit * h.qty, 0),
    oldestScanAt: hits.reduce((min, h) => (h.scannedAt < min ? h.scannedAt : min), hits[0].scannedAt),
  }));
  return nominations.sort((a, b) => b.anchorNetExPostage - a.anchorNetExPostage);
}

/** BasketLensItem plus the identity fields the wanted-list XML needs. */
export type PartArbScoredLot = BasketLensItem & { colourId: number; invID: number };

/**
 * Score a store's P/M lots into BasketLensItems for buildBasketDecisionReport.
 *
 * Same semantics as bl-basket's scoreAll, ex-postage: the common report strips the
 * proportional postage share back out anyway (fromBasketItem), so we pass
 * inboundPerUnit 0 and let the summary charge the full inbound postage once.
 * UK-grounded only: views with world/none coverage score as "no benchmark".
 */
export function scoreStoreLots(
  lots: StoreLot[],
  views: Map<string, PriceGuideView>,
  inputs: PartArbInputs
): PartArbScoredLot[] {
  const pm = lots.filter((l) => l.itemType !== 'S');
  const boilerplate = computeBoilerplate(pm);
  return pm.map((lot) => {
    const condition = lot.invNew === 'New' ? 'N' : 'U';
    const view = views.get(pgKey(lot.itemType, lot.itemNo, lot.itemType === 'P' ? lot.colourId : 0));
    const side = view && view.coverage === 'uk' ? (condition === 'N' ? view.new : view.used) : null;
    const damage = hasDamageNote(lot.description, boilerplate);
    const sellThru = side?.strQty ?? 0;
    const listPrice = side?.soldAvg != null ? bricqerListPrice(side.soldAvg, condition, sellThru) : null;
    const netPerUnit = listPrice != null ? listPrice * (1 - VAR_FEE_PCT) - lot.unitPriceGBP : null;
    const marginPct = listPrice != null && netPerUnit != null ? (netPerUnit / listPrice) * 100 : null;
    const passed =
      !damage &&
      lot.unitPriceGBP >= inputs.minAsk &&
      listPrice != null &&
      netPerUnit != null &&
      netPerUnit > 0 &&
      (marginPct as number) / 100 >= inputs.minMargin &&
      sellThru >= inputs.minStr;
    return {
      itemType: lot.itemType,
      itemNo: lot.itemNo,
      colourId: lot.itemType === 'P' ? lot.colourId : 0,
      invID: lot.invID,
      colourName: lot.colourName,
      itemName: lot.itemName,
      condition,
      invQty: lot.invQty,
      unitPriceGBP: lot.unitPriceGBP,
      ukSoldAvg: side?.soldAvg ?? null,
      ukSoldQty: side?.soldQty ?? 0,
      ukStockQty: side?.stockQty ?? 0,
      sellThru,
      listPrice,
      netPerUnit, // ex-postage; fromBasketItem adds inboundPerUnit (0) back
      inboundPerUnit: 0,
      marginPct,
      passed,
      damage,
    };
  });
}

/**
 * Map passed scored lots to wanted-list source rows (for --xml-only). The caller
 * filters by its wanted-min-STR first; mos is null (the personal-velocity model
 * lives in bl-basket and is not replicated here).
 */
export function wantedLotsFromScored(items: PartArbScoredLot[], minStr: number): WantedSourceLot[] {
  return items
    .filter((i) => i.passed && i.sellThru >= minStr)
    .map((i) => ({
      itemType: i.itemType,
      itemNo: i.itemNo,
      colourId: i.colourId,
      condition: i.condition,
      invQty: i.invQty,
      unitPriceGBP: i.unitPriceGBP,
      listPrice: i.listPrice,
      lotProfit: i.netPerUnit != null ? i.netPerUnit * i.invQty : null,
      sellThru: i.sellThru,
      marginPct: i.marginPct,
      ukSoldAvg: i.ukSoldAvg,
      mos: null,
    }));
}

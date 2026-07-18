/**
 * Consignment basket math (intl-set-arb F4). Exact per-basket landed cost —
 * unlike the flagger's amortised per-unit estimate, this computes the REAL
 * consignment: one shipping charge on total weight, one handling fee, duty and
 * VAT on the whole dutiable base, then allocates back to items proportionally
 * (by item value) for per-set margin display.
 */
import type { ZoneCosts } from './landed-cost';

export interface ConsignmentItem {
  itemNo: string;
  buyPriceGbp: number;
  weightG: number;
  sellNetGbp: number | null;   // null = no sell side (context item, not counted in margin)
  qty: number;
}

export interface ConsignmentBreakdown {
  itemsGbp: number;
  totalWeightG: number;
  shippingGbp: number;
  dutyGbp: number;
  vatGbp: number;
  handlingGbp: number;
  landedGbp: number;
  clearsFloor: boolean;          // >£135 border regime the model assumes
  sellNetGbp: number;            // Σ sell nets for priced items
  netMarginGbp: number;
  netMarginPct: number | null;
  perItem: Array<ConsignmentItem & { landedShareGbp: number; itemMarginGbp: number | null }>;
}

export const CONSIGNMENT_FLOOR_GBP = 135;

export function buildConsignment(zone: ZoneCosts, items: ConsignmentItem[]): ConsignmentBreakdown {
  const itemsGbp = items.reduce((a, i) => a + i.buyPriceGbp * i.qty, 0);
  const totalWeightG = items.reduce((a, i) => a + i.weightG * i.qty, 0);
  const shipping = zone.zone === 'UK' ? 0 : zone.ship_base_gbp + (totalWeightG / 100) * zone.ship_per_100g_gbp;
  const dutiable = itemsGbp + shipping;
  const duty = zone.zone === 'UK' ? 0 : zone.duty_rate * dutiable;
  const vat = zone.zone === 'UK' || zone.vat_recoverable ? 0 : zone.vat_rate * (dutiable + duty);
  const handling = zone.zone === 'UK' ? 0 : zone.handling_fee_gbp;
  const landed = itemsGbp + shipping + duty + vat + handling;

  const overhead = landed - itemsGbp;
  const perItem = items.map((i) => {
    const value = i.buyPriceGbp * i.qty;
    const share = itemsGbp > 0 ? value / itemsGbp : 0;
    const landedShare = +(value + overhead * share).toFixed(2);
    const itemMargin = i.sellNetGbp == null ? null : +(i.sellNetGbp * i.qty - landedShare).toFixed(2);
    return { ...i, landedShareGbp: landedShare, itemMarginGbp: itemMargin };
  });

  const sellNet = items.reduce((a, i) => a + (i.sellNetGbp ?? 0) * i.qty, 0);
  const pricedLanded = perItem.filter((i) => i.sellNetGbp != null).reduce((a, i) => a + i.landedShareGbp, 0);
  const netMargin = +(sellNet - pricedLanded).toFixed(2);

  return {
    itemsGbp: +itemsGbp.toFixed(2),
    totalWeightG,
    shippingGbp: +shipping.toFixed(2),
    dutyGbp: +duty.toFixed(2),
    vatGbp: +vat.toFixed(2),
    handlingGbp: +handling.toFixed(2),
    landedGbp: +landed.toFixed(2),
    clearsFloor: itemsGbp >= CONSIGNMENT_FLOOR_GBP,
    sellNetGbp: +sellNet.toFixed(2),
    netMarginGbp: netMargin,
    netMarginPct: pricedLanded > 0 ? +(netMargin / pricedLanded).toFixed(4) : null,
    perItem,
  };
}

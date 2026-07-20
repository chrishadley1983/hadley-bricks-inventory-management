/**
 * Landed-cost math for BL international set arbitrage (intl-set-arb F3).
 * Pure functions — the flagger service feeds them zone rows + offers.
 *
 * Model (collection-spec.md): consignment regime is ALWAYS >£135 border-VAT
 * (sub-£135 international is out of scope), so every intl unit carries duty +
 * (unrecoverable) import VAT on (item + shipping). Shipping and the single
 * handling fee are consignment-shared; the per-unit figure here uses the
 * weight-scaled MARGINAL shipping for this unit and amortises handling across
 * an assumed consignment of `handlingAmortiseUnits` (default 10 — a realistic
 * Asia basket; the consignment builder recomputes exactly per real basket).
 */
import { MAX_BUY_FEE, MAX_BUY_SHIP } from '../investment/max-buy';

export interface ZoneCosts {
  zone: string;
  countries: string[];
  duty_rate: number;
  vat_rate: number;
  vat_recoverable: boolean;
  handling_fee_gbp: number;
  ship_base_gbp: number;
  ship_per_100g_gbp: number;
  calibrated_at: string | null;
}

export const HANDLING_AMORTISE_UNITS = 10;

/** Map an ISO country code to its cost zone (ROW fallback). */
export function zoneForCountry(cc: string | null | undefined, zones: ZoneCosts[]): ZoneCosts {
  const up = (cc ?? '').toUpperCase();
  for (const z of zones) if (z.countries.includes(up)) return z;
  return zones.find((z) => z.zone === 'ROW') ?? zones[zones.length - 1];
}

/** Marginal shipping for one unit of `weightG` in a zone (base amortised away —
 * base is per-consignment; per-unit marginal is the weight-scaled component.
 * A lone-unit consignment pays base too; the flagger includes base/amortise. */
export function marginalShippingGbp(zone: ZoneCosts, weightG: number | null): number | null {
  if (weightG == null) return null;
  return (weightG / 100) * zone.ship_per_100g_gbp;
}

export interface LandedUnit {
  itemGbp: number;
  shippingGbp: number;   // marginal weight-scaled + amortised share of base
  dutyGbp: number;
  vatGbp: number;        // 0 when zone.vat_recoverable
  handlingGbp: number;   // amortised share
  landedGbp: number;
}

/** Per-unit landed cost under consignment amortisation. Null when weight unknown
 * (shipping unmodellable — never guess). UK zone: item + domestic postage share —
 * no duty, no import VAT, no customs handling. */
export function landedUnitGbp(zone: ZoneCosts, itemGbp: number, weightG: number | null): LandedUnit | null {
  if (zone.zone === 'UK') {
    const marginal = marginalShippingGbp(zone, weightG);
    if (marginal == null) return null;
    const shipping = marginal + zone.ship_base_gbp / HANDLING_AMORTISE_UNITS;
    return {
      itemGbp, shippingGbp: +shipping.toFixed(2), dutyGbp: 0, vatGbp: 0, handlingGbp: 0,
      landedGbp: +(itemGbp + shipping).toFixed(2),
    };
  }
  const marginal = marginalShippingGbp(zone, weightG);
  if (marginal == null) return null;
  const shipping = marginal + zone.ship_base_gbp / HANDLING_AMORTISE_UNITS;
  const dutiable = itemGbp + shipping;
  const duty = zone.duty_rate * dutiable;
  const vat = zone.vat_recoverable ? 0 : zone.vat_rate * (dutiable + duty);
  const handling = zone.handling_fee_gbp / HANDLING_AMORTISE_UNITS;
  const landed = itemGbp + shipping + duty + vat + handling;
  return {
    itemGbp,
    shippingGbp: +shipping.toFixed(2),
    dutyGbp: +duty.toFixed(2),
    vatGbp: +vat.toFixed(2),
    handlingGbp: +handling.toFixed(2),
    landedGbp: +landed.toFixed(2),
  };
}

// ---------------------------------------------------------------------------
// Sell-channel valuation — extensible so eBay can be added without touching
// the flagger (done-criteria: "wire it so we can add eBay again").
// ---------------------------------------------------------------------------

export type SellChannel = 'amazon' | 'ebay';

export interface ChannelQuote {
  channel: SellChannel;
  sellPriceGbp: number;
  sellNetGbp: number;      // NET: after channel fees AND outbound ship (house convention)
  /** 90-day average sale basis (Keepa avg90 buy box); null when unknown. */
  was90Gbp: number | null;
  velocityDrops90: number | null;
  salesRank: number | null;
  /** Snapshot date the quote was priced from (YYYY-MM-DD) — consumers badge age. */
  snapshotDate: string | null;
  meta: Record<string, unknown>;
}

export interface ChannelValuer {
  channel: SellChannel;
  /** Null = this channel can't value the set (no ASIN / no price / stale). */
  quote(setNorm: string): ChannelQuote | null;
}

/** House Amazon constants — single source is investment/max-buy.ts; never re-declare. */
export const AMAZON_FEE_SHARE = MAX_BUY_FEE;
export const AMAZON_OUTBOUND_SHIP_GBP = MAX_BUY_SHIP;

/** House NET back for one unit: sale less fees less outbound ship. */
export function amazonNetGbp(saleGbp: number): number {
  return +(saleGbp * (1 - AMAZON_FEE_SHARE) - AMAZON_OUTBOUND_SHIP_GBP).toFixed(2);
}

export interface AmazonSetIntel {
  asin: string;
  buyBox: number | null;
  was90: number | null;
  drops90: number | null;
  salesRank: number | null;
  snapshotDate: string | null;
  asinConfidence: number | null;
}

export function makeAmazonValuer(bySet: Map<string, AmazonSetIntel>): ChannelValuer {
  return {
    channel: 'amazon',
    quote(setNorm) {
      const r = bySet.get(setNorm);
      if (!r?.buyBox || r.buyBox <= 0) return null;
      return {
        channel: 'amazon',
        sellPriceGbp: r.buyBox,
        sellNetGbp: amazonNetGbp(r.buyBox),
        was90Gbp: r.was90 != null && r.was90 > 0 ? r.was90 : null,
        velocityDrops90: r.drops90,
        salesRank: r.salesRank,
        snapshotDate: r.snapshotDate,
        meta: { asin: r.asin, asinConfidence: r.asinConfidence },
      };
    },
  };
}

/**
 * Ships-to-me enrichment for set stock offers (Tier-1 intl set-arb, 2026-07-15).
 *
 * The catalogPG page (our free scrape lane) shows a uniform store icon — it does NOT
 * expose per-listing ships-to-me (the green/red indicator renders only on the interactive
 * item page). The BL store API's price-guide `price_detail` DOES: each listing carries
 * `shipping_available` (true = ships to the API account's location = UK/domham91). So we
 * combine — page for seller+international, API for ships — matched by GBP price (2dp).
 *
 * Only called for SETS that actually have cheap international supply (UK listings always
 * ship, so need no check) — keeps the API spend proportional to real opportunity.
 */

import type { BrickLinkClient } from './client';
import { offerKey } from './price-guide-page';

interface PriceDetailEntry {
  unit_price?: string;
  shipping_available?: boolean;
}

/** price(2dp) → does ANY listing at that price ship to me. 2 API calls (N + U). */
export async function fetchSetShipsMap(bl: BrickLinkClient, setNo: string): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  for (const condition of ['N', 'U'] as const) {
    let guide: { price_detail?: PriceDetailEntry[] };
    try {
      guide = (await bl.getPartPriceGuide('SET', setNo, 0, {
        guideType: 'stock',
        condition,
        currencyCode: 'GBP',
      })) as { price_detail?: PriceDetailEntry[] };
    } catch {
      continue; // one condition failing shouldn't drop the other
    }
    for (const d of guide.price_detail ?? []) {
      const price = parseFloat(d.unit_price ?? '');
      if (!Number.isFinite(price)) continue;
      const k = offerKey(price);
      map.set(k, (map.get(k) ?? false) || !!d.shipping_available);
    }
  }
  return map;
}

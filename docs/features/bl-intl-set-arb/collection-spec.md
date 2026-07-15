# BL → Amazon International Set Arbitrage — Data-Collection Spec

**Status:** approved design, pre-build (Chris 2026-07-15). Arb calc/view deferred until
weeks of `stock_offers` history + Tier-2 seller data exist.

## Objective

Rebuild the dead BL→Amazon set-arb by first collecting rich international-seller price
data. Flag opportunities from the free page lane (Tier 1); ground precise landed cost on
demand (Tier 2). **Arb unit = a per-seller consignment basket**, targeting high-volume
Asian sellers (HK / CN / MY / SG) whose volume lets us amortise shipping.

## Decisions (Chris, 2026-07-15)

- **International only ABOVE £135.** Sub-£135 international is killed by shipping — don't
  flag or model it. So we are ALWAYS in the border-VAT + handling + duty regime (no
  point-of-sale-VAT case to model). Below £135 = UK sourcing only.
- **Store the top 15 cheapest listings THAT SHIP TO ME** per set (green square /
  `shipping_available=true`). Discard non-shipping listings and everything past 15.
- **Import VAT is unrecoverable** — Hadley Bricks is deliberately VAT-unregistered (June
  40/30/10 model stays under £90k). The 20% import VAT is dead COG. Model carries a
  `vat_recoverable` switch = **false** now; flip to true only if the business ever
  registers (then reclaim import VAT but charge output VAT — a different model entirely).
- **Consignment-level landed cost.** Shipping + the single ~£10 handling fee are shared
  across all sets bought from one seller — high volume is the whole point. Batch to >£135
  deliberately.
- **Asia is the strong zone.** HK/CN have no UK FTA → 4% duty. SG/MY are CPTPP but
  preference needs origin docs small sellers won't give (and LEGO is often China-origin),
  so **assume 4%**. Steep weight-scaled shipping band. High seller volume makes the
  consignment batching viable despite the distance.
- **Real test order** to calibrate the Asia shipping bands and observe BL/courier actual
  import-VAT + handling behaviour before trusting the model.

## Tier 1 — parser change (page lane, collect NOW, before the 90-day set fill)

Enrich the set price-guide scrape (near-zero extra cost — all on the page):

- **Per set:** `weight_g`, `dims_cm` from Item Info (load-bearing for shipping).
- **Per listing:** the **top 15 cheapest that ship to me** (green square), each
  `{ price_gbp, qty, intl (tilde present = converted/international) }`. Nothing else stored.
- **Store:** `stock_offers` jsonb + `weight_g` / `dims_cm` on `bricklink_price_guide_cache`.
- **Derived at parse:** `cheapest_uk_ships`, `cheapest_intl_ships`, `intl_saving_vs_uk`.
- Tilde distinguishes UK (native GBP) vs international; it does NOT give country — that's
  Tier 2. Tier-1 applies a **conservative Asia-band default** to any international listing
  so we don't over-flag (Asian sellers list in USD, so currency can't identify them).

## Tier 2 — on demand (flagged candidates only)

- Scrape the **Items-For-Sale** page → per-lot **seller + country** (the only source that
  exposes country).
- Group flagged sets by seller → find high-volume sellers holding several flagged sets →
  build a **consignment basket** (bl-basket pattern applied to international sets).

## Landed-cost reference model — `bl_import_zone_costs`

One row per source zone, read by the (deferred) arb calc.

| zone | duty_default | vat_rate | handling_fee | ship_base | ship_per_100g |
|---|---|---|---|---|---|
| UK | 0% | — | £0 | UK band | — |
| EU | 4%* | 20% | £10 | £4 | £0.60 |
| US/CA | 4% | 20% | £10 | £9 | £1.20 |
| **ASIA** (HK/CN/MY/SG/JP/KR) | **4%** | 20% | £10 | £11 | £2.00 |
| RoW | 4% | 20% | £10 | £12 | £2.00 |

*EU 0% only with origin proof; default 4%. Bands are placeholders — calibrate via test order.

**Consignment formula** (always >£135 regime):
```
landed = Σ item_gbp
       + shipping(zone, total_weight_g)
       + duty_rate(zone) × (Σitem + shipping)
       + (vat_recoverable ? 0 : 0.20 × (Σitem + shipping))   # false now → dead COG
       + handling_fee                                          # once per consignment
```
The Asian item price must clear ~25%+ below UK just to absorb the unrecoverable VAT + duty
before any real margin — which China-market pricing (often 30–50% under UK) can do, but
only if the model is precise, not optimistic.

## Deferred

Arb calc + `/arbitrage` view rebuild — once weeks of `stock_offers` history + Tier-2
seller data exist.

## To ground

- Test order: calibrate ASIA shipping bands + confirm real import VAT + handling.
- SG/MY CPTPP preference reality — assume 4% until proven.

## Strategic hinge

If international arb scales, it pushes on the VAT-registration decision (June 40/30/10
model). Registered → reclaim import VAT but charge output VAT. Not a today decision; the
thing to watch as international volume grows.

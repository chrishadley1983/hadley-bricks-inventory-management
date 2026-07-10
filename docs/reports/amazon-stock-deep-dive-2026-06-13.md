# Amazon Stock Deep-Dive — Health & Q4 Readiness

**Date:** 2026-06-13 · **Prepared for:** Chris Hadley · **Scope:** Live Amazon (FBM) catalogue

Data sources: `inventory_items` (live stock, cost), `order_items` + `platform_orders` (full Amazon
order history back to 31 Jan 2025), `amazon_arbitrage_pricing` (fresh buy-box/BSR/offer snapshots —
234/246 live ASINs priced ≤2 days old), `brickset_sets` (set names), `platform_listings` (March
cross-check). Margin = net Amazon proceeds − cost − est. postage (£3 if sale <£14, else £4, estimate).

---

## 1. Scorecard

| Metric | Value |
|---|---|
| Live Amazon stock | **596 copies / 242 ASINs** |
| Cost capital tied up | **£7,672** |
| Never-sold ASINs (all-time, since Jan 2025) | **136 (56% of ASINs)** — £4,326 / 283 copies |
| Median BSR | **~195,000** (Toys & Games — slow) |
| Buy-box win rate | **61 / 235 = 26%** (32% of the 191 where a buy box exists) |
| Listings losing the buy box | **130 (55%)** |
| Listings with **no buy box at all** (winnable) | **44** · Low-competition (≤3 sellers) | 36 |
| **12-month realised sales** | **1,459 · £18,274 net profit · 29.5% margin** (39 losses, −£124) |

---

## 2. Headline: two focus areas are non-issues

| Focus area | Verdict | Evidence |
|---|---|---|
| Selling at **poor margin** | ✅ Not a problem | 29.5% avg margin, £124 of losses across 1,459 sales |
| **Close to but not winning buy box** | ✅ Not a problem | **Zero** listings priced above buy box |
| **Listed but never sold** | 🔴 **Core problem** | 136 ASINs / £4,326 (56% of capital) |

**Root cause splits in two — neither fixed by cutting price:**
1. **Dead demand** (BSR >300k) — priced at buy box, no buyers.
2. **Buried FBM offer** — real demand, but I sit under 15–47 competitors so never convert.

---

## 3. The four segments (£4,326 of dead capital)

| Segment | ASINs | Capital | What it is | Action |
|---|---|---|---|---|
| **A. Buried — has demand** (BSR ≤50k) | ~19 | ~£848 | Good sellers, I lose the buy box / buried under offers | Win where winnable; else eBay/BL or FBA |
| **B. Slow** (BSR 50–300k) | ~46 | ~£1,030 | Weak demand | Light markdown; don't reorder |
| **C. Dead** (BSR >300k) | 59 | **£1,828** | Match buy box, nobody buys | **Liquidate** |
| **D. Junk / non-LEGO** | 1 | **£482** | *Strictly Briks* generic (B01K37SXH6), 82 copies, 0 sales | Dump; stop buying non-LEGO |

---

## 4. Quick-win list — real demand, not selling (BSR ≤ 50k)

"Buy box = none" → no buy-box holder; a sharp FBM price can **win it**.

| Set | Name · Theme | Copies | Cost | Days | BSR | Buy box | Offers | Read |
|---|---|---|---|---|---|---|---|---|
| 75402 | ARC-170 Starfighter · Star Wars | 1 | £30 | 450 | 1,833 | £44.99 | 38 | Hot, buried 15mo (1 sold Mar '25) — relist/clear |
| 42610 | Karaoke Music Party · Friends | 1 | £6 | 103 | 1,970 | £20.74 | 27 | bb > 90d avg; undercut to ~£18 |
| 60304 | Road Plates · City | 1 | £0 | 150 | 2,713 | £14.39 | 26 | Perennial seller — win it |
| 43273 | Disney Frozen Advent Calendar 2025 · Advent | 5 | £79 | 175 | 5,380 | £21.99 | 43 | Seasonal — push pre-Xmas or eBay |
| 42164 | Off-Road Race Buggy · Technic | 1 | £8 | 80 | 7,747 | **none** | 23 | **No buy box → winnable** |
| 40499 | Santa's Sleigh · Seasonal | 5 | £120 | 488 | 8,269 | £37.84 | 47 | 16mo unsold, 47 sellers — clear elsewhere |
| 75390 | Luke Skywalker X-Wing Mech · Star Wars | 2 | £15 | 108 | 18,700 | **none** | 15 | **No buy box → winnable** |
| 72040 | Captain Toad's Camp · Super Mario | 1 | £13 | 116 | 22,396 | **none** | 7 | **Low comp + no bb → easy win** (1 sold Apr '26) |
| 71841 | Dragonian Storm Village · Ninjago | 5 | £89 | 175 | 34,240 | £40.99 | 19 | Price to contend |
| 10931 | Truck & Tracked Excavator · Duplo | 1 | £8 | 114 | 36,180 | **none** | 17 | **No buy box → winnable** |
| 75354 | Coruscant Guard Gunship · Star Wars | 4 | **£383** | 198 | 46,304 | £177.89 | 23 | **Biggest capital** — FBA candidate for Q4 |

---

## 5. Liquidate list — dead demand, zero all-time sales (BSR > 300k)

| Set | Name · Theme | Copies | Cost | Days | BSR | Buy box |
|---|---|---|---|---|---|---|
| 21018 | United Nations Headquarters · Architecture | 5 | **£325** | 459 | 641k | £139.99 |
| 80049 | Dragon of the East Palace · Monkie Kid | 2 | **£237** | 494 | 581k | £229.99 |
| 21262 | The Windmill Farm · Minecraft | 5 | £140 | 115 | 303k | £68.99 |
| 21004 | Solomon R. Guggenheim Museum · Architecture | 2 | £111 | 554 | 328k | £158.99 |
| 10282 | Adidas Originals Superstar Bundle · Icons | 1 | £57 | 95 | 376k | £124.99 |
| 6865 | Captain America's Avenging Cycle · Marvel | 3 | £56 | 443 | 450k | £43.49 |
| 75048 | The Phantom · Star Wars | 1 | £49 | 94 | 872k | £118.99 |
| 80030 | Monkie Kid's Staff Creations · Monkie Kid | 2 | £37 | 445 | 388k | £46.99 |

**~£1,000 in these 8.** Full BSR>300k tail recovers **~£1,828** for Q4.

---

## 6. Q4 restock signal — proven velocity (last 180 days)

| Set | Name · Theme | Sales | Avg sale | Profit/unit | 180d profit |
|---|---|---|---|---|---|
| 76329 | Miles Morales' Mask · Marvel | 24 | £47.56 | £22.06 | £529 |
| ★ 21019 | The Eiffel Tower · Architecture | 11 | £120.10 | **£58.45** | £643 |
| ★ 75111 | Darth Vader (buildable) · Star Wars | 12 | £70.23 | £27.70 | £332 |
| 40530 | Jane Goodall Tribute · Promotional | 13 | £39.38 | £17.25 | £224 |
| 40759 | Valentine's Day Box · Seasonal | 20 | £25.16 | £7.47 | £149 |
| 40700 | Winter Holiday Train · Seasonal | 14 | £34.65 | £10.06 | £141 |
| 42149/42150 | Monster Jam Dragon / Monster Mutt · Technic | 12/13 | ~£26 | ~£9 | £132/£85 |

Pattern: **40xxx seasonal/promo** = volume (thin margin); **marquee** (Eiffel, Darth Vader) = profit. Stock both before October.

---

## 7. Strategic recommendations for Q4

1. **Decide on FBA for a curated range.** 55% of listings lose the buy box; saturated FBM won't
   convert in a Prime-heavy Q4. FBA the proven sellers (Miles Morales' Mask, Eiffel, Darth Vader,
   Jane Goodall) + the buried Coruscant Guard Gunship (75354) — where margin absorbs FBA fees.
2. **Clear the dead tail (~£2.3k)** — liquidate BSR>300k (§5, £1,828) + Strictly Briks (£482).
3. **Win the free wins** — ~44 no-buy-box + ~36 low-comp listings; price to win, no FBA needed.
4. **Restock velocity before October** — 40xxx for volume; Eiffel/Darth Vader for margin.
5. **Don't chase price** — margins healthy; you're never above buy box.
6. **Purchasing discipline** — £700+ frozen in dead Architecture (UN HQ 21018, Guggenheim 21004) +
   £482 non-LEGO were avoidable; check BSR before buying high-value/non-LEGO.
7. **Data fix** — capture live quantity, FBM/FBA channel, buy-box holder daily for an auto-flag dashboard.

---

## 8. How "never sold" was measured · data window

ASIN-level: currently-listed Amazon ASINs (`status='LISTED'` + `amazon_asin` + `listing_platform='amazon'`)
matched against every ASIN that has ever appeared in the Amazon order history
(`order_items.item_number` = ASIN, joined to `platform_orders`). "Never sold" = a listed ASIN absent
from that history.

The first pass used the inventory-linked window (from ~9 Jan 2026). **Extending to the full raw Amazon
order history already in the system (back to 31 Jan 2025, ~17 months) reclassified just 8 ASINs**
(139 → 136) and barely moved dead-stock capital (£1,863 → £1,828) — conclusions unchanged. Data before
Jan 2025 / beyond SP-API's ~24-month retention isn't retrievable but would not change the picture.

## 9. Caveats

- Amazon-specific; a few never-sold-on-Amazon sets sell on eBay/BL.
- BSR is point-in-time — bands are demand tiers, not exact velocity.
- Postage in margin is a flat £3/£4 estimate; large sets cost more.
- `platform_listings` is a March snapshot; 21 live ASINs showed "Inactive" there — worth a Seller-Central listing-health pass.

# BL → Amazon Intl Set Arb — Build Done Criteria

**Approved:** Chris 2026-07-18 ("systematically work through all 6, then high-quality
UI/UX replacing the existing page — clean start BUT wire it so we can add eBay again").
Extends `collection-spec.md` (data collection, built #602–#609) into the full feature.

## Criteria

- **F1 — Catalogue weights/dims.** `bl_catalog_items` (item_type, item_no, name,
  weight_g, dim_x/y/z_cm, year_from) loaded from the BL catalogue download for sets
  (and parts, retro). ≥95% of the 3,314 post-2021 targets have weight_g.
- **F2 — Zone costs.** `bl_import_zone_costs` seeded per spec (UK/EU/US_CA/ASIA/ROW;
  duty 4% default, VAT 20% unrecoverable, £10 handling, weight-scaled bands,
  `calibrated_at` null until a real order grounds it).
- **F3 — Candidate flagger.** `bl_set_arb_candidates` computed from stock_offers ×
  zone costs × Amazon sell side (Buy Box / Keepa via existing tables, ~17% fees,
  drops90 velocity). Keyed (set, source_zone, **sell_channel**) — 'amazon' now, 'ebay'
  addable without migration. Sell-side valuation behind a `ChannelValuer` interface.
  Refreshes nightly after the 00:05 lane D run. >£135 intl-only rule enforced.
- **F4 — Consignment builder.** Candidates grouped by seller; on-demand Tier-2 store
  pull for a flagged seller; consignment basket = Σ items + shared shipping(weight) +
  duty + VAT + one handling fee; basket net margin + per-set breakdown.
- **F5 — Calibration.** Zone bands editable; "record actuals" writes real
  shipping/VAT/handling from the test order back with `calibrated_at`; UI badges
  UNCALIBRATED until then.
- **F6 — Tail.** Offer-less targets marked checked-no-listings vs pending; no dedicated
  scrape; nightly heals.
- **F7 — UI.** `/arbitrage` fully replaced: consignment-first purchase-decision view
  (seller baskets ranked by net margin, landed-cost breakdown, Amazon price + velocity,
  exclude/bought actions, calibration badge). Channel tab bar with Amazon active; eBay
  tab stub present but disabled. Old BrickLink/eBay/Seeded page code removed.

## Non-goals (this build)

- eBay valuation logic (slot only), auto-purchase, VAT-registered model
  (`vat_recoverable` stays false), sub-£135 international.

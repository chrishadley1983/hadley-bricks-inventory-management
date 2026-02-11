# Tasks: lego-investment-phase2

## Implementation Tasks (verification implicit)

- [ ] F1: ASIN linkage from seeded_asins to brickset_sets
  - blocked_by: none
  - criterion: "Service populates brickset_sets.amazon_asin from seeded_asins where confidence >= 60%"
  - verify_type: AUTO

- [ ] F2: Auto-classification of investment attributes
  - blocked_by: none
  - criterion: "Classification service populates is_licensed, is_ucs, is_modular, exclusivity_tier with override support"
  - verify_type: AUTO

- [ ] F3: Investment API returns Amazon pricing data
  - blocked_by: F1
  - criterion: "/api/investment and /api/investment/[setNumber] return buy_box_price, was_price, sales_rank, offer_count"
  - verify_type: AUTO

- [ ] E1: Missing ASIN gracefully handled in UI
  - blocked_by: F3
  - criterion: "Sets without ASIN show 'No Amazon data' / '—' with no errors"
  - verify_type: AUTO

- [ ] E2: Classification override persists through re-sync
  - blocked_by: F2
  - criterion: "classification_override JSONB preserved on re-run, takes precedence in API"
  - verify_type: AUTO

- [ ] I1: Investment dashboard columns updated with Amazon data
  - blocked_by: F3
  - criterion: "DataTable adds buy box price (sortable), sales rank, offer count columns"
  - verify_type: AUTO

- [ ] F4: Set detail page at /investment/[setNumber]
  - blocked_by: F3, I1
  - criterion: "Detail page shows set info, classification, Amazon pricing, with row click navigation"
  - verify_type: AUTO

- [ ] F5: Price history chart on set detail page
  - blocked_by: F4
  - criterion: "Line chart of buy box price over time with RRP reference line, empty state handling"
  - verify_type: AUTO

- [ ] F6: Price movement Discord alerts
  - blocked_by: F1
  - criterion: "Post-pricing-cron step alerts Discord when buy box price changes >20%"
  - verify_type: AUTO

- [ ] P1: Set detail page loads within 2 seconds
  - blocked_by: F4, F5
  - criterion: "Page loads all data including price history chart in < 2000ms"
  - verify_type: AUTO

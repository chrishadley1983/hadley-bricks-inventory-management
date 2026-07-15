-- Tier-1 international set-arb data collection (docs/features/bl-intl-set-arb/collection-spec.md).
-- Per-set: the cheapest 15 current listings + ALL UK listings, each with seller identity and
-- an international flag, captured free from the catalogPG page scrape. Country/ships-to-me are
-- Tier-2 grounding (store API). Populated only for SET rows (item_type='S').
alter table bricklink_price_guide_cache add column if not exists stock_offers jsonb;

comment on column bricklink_price_guide_cache.stock_offers is
  'SETS only. { new: [{price,qty,intl,storeId,storeName}], used: [...] } — cheapest 15 listings + all UK, per condition, from the catalogPG scrape. Feeds BL->Amazon international set arb (Tier 1). Country/shipping = Tier 2.';

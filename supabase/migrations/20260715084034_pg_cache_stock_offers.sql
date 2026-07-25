alter table bricklink_price_guide_cache add column if not exists stock_offers jsonb;
comment on column bricklink_price_guide_cache.stock_offers is
  'SETS only. { new: [{price,qty,intl,storeId,storeName}], used: [...] } — cheapest 15 listings + all UK, per condition, from the catalogPG scrape. Feeds BL->Amazon international set arb (Tier 1). Country/shipping = Tier 2.';;

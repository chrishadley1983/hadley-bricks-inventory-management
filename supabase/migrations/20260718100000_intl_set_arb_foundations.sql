-- Intl set-arb foundations (feature/intl-set-arb F1+F2, done-criteria.md):
-- 1. bl_catalog_items — BL catalogue identity/weights/dims from catalogDownload.asp
--    (weight is load-bearing for zone-shipping landed cost; Brickset covers only ~10%).
-- 2. bl_import_zone_costs — landed-cost reference model per collection-spec.md.
-- 3. bl_set_arb_candidates — flagger output, keyed (set, source_zone, sell_channel)
--    so eBay can be added as a channel without migration.

create table if not exists public.bl_catalog_items (
  item_type text not null check (item_type in ('P','S','M','G','B','C','I','O')),
  item_no text not null,
  category_id integer,
  category_name text,
  item_name text not null,
  year_released integer,
  weight_g numeric,          -- null = BL lists '?'
  dim_x_cm numeric,
  dim_y_cm numeric,
  dim_z_cm numeric,
  imported_at timestamptz not null default now(),
  primary key (item_type, item_no)
);
alter table public.bl_catalog_items enable row level security;
create policy "service role only - bl_catalog_items" on public.bl_catalog_items
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create table if not exists public.bl_import_zone_costs (
  zone text primary key,                    -- UK / EU / US_CA / ASIA / ROW
  countries text[] not null default '{}',   -- ISO cc list routed to this zone
  duty_rate numeric not null default 0.04,  -- default 4% (no-FTA / unproven preference)
  vat_rate numeric not null default 0.20,
  vat_recoverable boolean not null default false, -- business is VAT-unregistered
  handling_fee_gbp numeric not null default 10,
  ship_base_gbp numeric not null,
  ship_per_100g_gbp numeric not null,
  calibrated_at timestamptz,                -- null = placeholder bands (UNCALIBRATED)
  notes text,
  updated_at timestamptz not null default now()
);
alter table public.bl_import_zone_costs enable row level security;
create policy "service role only - bl_import_zone_costs" on public.bl_import_zone_costs
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

insert into public.bl_import_zone_costs
  (zone, countries, duty_rate, vat_rate, handling_fee_gbp, ship_base_gbp, ship_per_100g_gbp, notes)
values
  ('UK',    '{UK,GB}',                       0,    0.20, 0,  0,  0,    'domestic — no import regime'),
  ('EU',    '{DE,NL,FR,BE,AT,IT,ES,PL,HU,CZ,DK,SE,FI,IE,PT,LU,SI,SK,EE,LV,LT,HR,RO,BG,GR,MT,CY}',
                                             0.04, 0.20, 10, 4,  0.60, 'EU 0% only with origin proof; default 4%'),
  ('US_CA', '{US,CA}',                       0.04, 0.20, 10, 9,  1.20, null),
  ('ASIA',  '{HK,CN,MY,SG,JP,KR,TW,TH,VN,ID,PH}',
                                             0.04, 0.20, 10, 11, 2.00, 'strong zone — SG/MY CPTPP unproven, assume 4%'),
  ('ROW',   '{}',                            0.04, 0.20, 10, 12, 2.00, 'fallback zone for any unlisted country')
on conflict (zone) do nothing;

create table if not exists public.bl_set_arb_candidates (
  id uuid primary key default gen_random_uuid(),
  item_no text not null,
  condition text not null check (condition in ('N','U')),
  sell_channel text not null default 'amazon' check (sell_channel in ('amazon','ebay')),
  source_zone text not null references public.bl_import_zone_costs(zone),
  source_country text,
  source_store_id bigint,
  source_store_name text,
  buy_price_gbp numeric not null,           -- item price at source (pre-landing)
  buy_qty integer not null default 1,
  weight_g numeric,
  landed_unit_gbp numeric,                  -- consignment-marginal landed cost per unit
  sell_price_gbp numeric,                   -- channel sell price used
  sell_net_gbp numeric,                     -- after channel fees
  net_margin_gbp numeric,
  net_margin_pct numeric,
  velocity_drops90 integer,
  amazon_asin text,
  uk_cheapest_gbp numeric,                  -- domestic alternative for context
  flags jsonb not null default '{}',        -- e.g. {"uncalibrated":true,"asin_unverified":true}
  status text not null default 'active' check (status in ('active','excluded','bought','stale')),
  computed_at timestamptz not null default now(),
  unique (item_no, condition, sell_channel, source_store_id)
);
create index if not exists idx_arb_candidates_margin on public.bl_set_arb_candidates (sell_channel, status, net_margin_gbp desc);
create index if not exists idx_arb_candidates_store on public.bl_set_arb_candidates (source_store_id);
alter table public.bl_set_arb_candidates enable row level security;
create policy "service role only - bl_set_arb_candidates" on public.bl_set_arb_candidates
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

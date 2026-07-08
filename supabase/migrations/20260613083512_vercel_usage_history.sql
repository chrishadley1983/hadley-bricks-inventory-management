-- Daily history of scraped Vercel usage (scraped_metrics holds only the
-- latest per key — PK is just `key` — so trend/projection had no history).
create table if not exists vercel_usage_history (
  key text not null,
  scrape_date date not null,
  value numeric,
  unit text,
  scraped_at timestamptz default now(),
  primary key (key, scrape_date)
);
create index if not exists vercel_usage_history_key_date
  on vercel_usage_history (key, scrape_date desc);

alter table vercel_usage_history enable row level security;
create policy vercel_usage_history_read on vercel_usage_history for select using (true);

-- Seed the two fluid-CPU points observed 12-13 Jun (the table overwrote the
-- rest), plus today's full snapshot, so the projection has a baseline.
insert into vercel_usage_history (key, scrape_date, value, unit) values
  ('vercel_fluid_active_cpu', '2026-06-12', 26580, 'seconds'),
  ('vercel_fluid_active_cpu', '2026-06-13', 26880, 'seconds'),
  ('vercel_fluid_provisioned_memory', '2026-06-13', 227.0, 'GB-Hrs')
on conflict (key, scrape_date) do nothing;;

-- 1-minute downsampled live telemetry from the Octopus Home Mini
create table if not exists energy_live (
  minute_start timestamptz primary key,
  demand_w_avg numeric,
  demand_w_max numeric,
  demand_w_min numeric,
  consumption_wh numeric,        -- Wh consumed within the minute (register delta)
  sample_count int default 0,
  created_at timestamptz default now()
);
create index if not exists energy_live_minute_idx on energy_live (minute_start desc);

-- Detected appliance/usage events from telemetry deltas
create table if not exists energy_events (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  ended_at timestamptz,
  event_type text not null,        -- kettle | oven | ev_charge | high_load | spike | unknown
  avg_demand_w numeric,
  peak_demand_w numeric,
  energy_kwh numeric,
  cost_pence numeric,
  detail jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists energy_events_started_idx on energy_events (started_at desc);

alter table energy_live enable row level security;
alter table energy_events enable row level security;
create policy energy_live_read on energy_live for select using (true);
create policy energy_events_read on energy_events for select using (true);;

-- Persistent daily BrickLink API call counter.
--
-- BL's 5000/day limit has no real-time enforcement: BL does not return HTTP 429,
-- does not send rate-limit response headers, and exposes no usage endpoint. The
-- only signal is a next-day warning email and a manual block of the consumer
-- key. This table is our only way to track usage and gate spend.
--
-- One row per UTC date. Multiple callers (cron jobs, manual scripts, partout UI)
-- increment the same row; `by_caller` tracks the breakdown.

create table public.bricklink_api_calls_daily (
  call_date date primary key,
  count int not null default 0,
  by_caller jsonb not null default '{}'::jsonb,
  last_call_at timestamptz,
  updated_at timestamptz not null default now()
);

create index bricklink_api_calls_daily_updated_at_idx
  on public.bricklink_api_calls_daily (updated_at desc);

alter table public.bricklink_api_calls_daily enable row level security;

create policy "Service role full access"
  on public.bricklink_api_calls_daily
  for all
  to service_role
  using (true)
  with check (true);

create policy "Authenticated read"
  on public.bricklink_api_calls_daily
  for select
  to authenticated
  using (true);

-- Atomic increment. Returns the new total for today.
-- Called from BrickLinkClient.request() after every API call.
create or replace function public.increment_bricklink_api_call(p_caller text default 'unknown')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_count int;
  v_today date := (now() at time zone 'utc')::date;
begin
  insert into public.bricklink_api_calls_daily (call_date, count, by_caller, last_call_at, updated_at)
  values (
    v_today,
    1,
    jsonb_build_object(p_caller, 1),
    now(),
    now()
  )
  on conflict (call_date) do update set
    count = bricklink_api_calls_daily.count + 1,
    by_caller = jsonb_set(
      coalesce(bricklink_api_calls_daily.by_caller, '{}'::jsonb),
      array[p_caller],
      to_jsonb(coalesce((bricklink_api_calls_daily.by_caller ->> p_caller)::int, 0) + 1)
    ),
    last_call_at = now(),
    updated_at = now()
  returning count into v_new_count;

  return v_new_count;
end;
$$;

grant execute on function public.increment_bricklink_api_call(text) to service_role;
grant execute on function public.increment_bricklink_api_call(text) to authenticated;

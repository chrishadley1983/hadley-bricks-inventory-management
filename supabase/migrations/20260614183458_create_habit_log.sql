-- Private single-habit accountability tracker. SENSITIVE.
-- log_date is PK so PostgREST upsert (on_conflict=log_date) dedups per day.
create table if not exists public.habit_log (
  log_date    date primary key,
  result      text not null check (result in ('Y','N')),
  day_number  integer not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Keep updated_at fresh on upsert.
create or replace function public.habit_log_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_habit_log_touch on public.habit_log;
create trigger trg_habit_log_touch
  before update on public.habit_log
  for each row execute function public.habit_log_touch_updated_at();

-- SENSITIVE: enable RLS with NO policies. service_role (used by Hadley API)
-- bypasses RLS; anon/authenticated keys get zero access.
alter table public.habit_log enable row level security;;

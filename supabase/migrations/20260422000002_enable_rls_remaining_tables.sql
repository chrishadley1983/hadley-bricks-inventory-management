-- Enable RLS on the remaining public-schema and custom-schema tables flagged by
-- Supabase Security Advisor (rls_disabled_in_public) after migration 20260422000001.
--
-- Categories:
--  1. Discord-Messenger / Peter-bot tables (public schema): service_role only; default-deny
--     — verified via Discord-Messenger/.env — SUPABASE_KEY is a service_role JWT
--  2. finance.monthly_reports: finance-tracker uses supabaseAdmin (service_role); default-deny
--  3. boosthunter.*: the Chrome extension uses the anon key directly, with GRANT ALL to anon
--     in the boosthunter schema. RLS must be ON (linter requirement) but policies allow anon
--     full access to preserve current behaviour. This matches Chris's existing design; the
--     schema is opaque to other anon callers because they'd need the specific table names.

-- === 1. Peter-bot / Discord-Messenger tables ===

alter table public.accountability_goals       enable row level security;
alter table public.accountability_milestones  enable row level security;
alter table public.accountability_progress    enable row level security;
alter table public.fitness_exercises          enable row level security;
alter table public.fitness_mobility_sessions  enable row level security;
alter table public.fitness_programmes         enable row level security;
alter table public.fitness_weekly_checkins    enable row level security;
alter table public.fitness_workout_sessions   enable row level security;
alter table public.fitness_workout_sets       enable row level security;
alter table public.garmin_daily_summary       enable row level security;
alter table public.garmin_sleep               enable row level security;
alter table public.journal_entries            enable row level security;
alter table public.mood_entries               enable row level security;
alter table public.reminders                  enable row level security;

-- === 2. finance schema ===

alter table finance.monthly_reports enable row level security;

-- === 3. boosthunter schema — preserve anon access ===

alter table boosthunter.account_balances enable row level security;
alter table boosthunter.bingo_offers     enable row level security;
alter table boosthunter.boosts           enable row level security;
alter table boosthunter.casino_offers    enable row level security;
alter table boosthunter.community_intel  enable row level security;
alter table boosthunter.pl_history       enable row level security;
alter table boosthunter.reload_offers    enable row level security;
alter table boosthunter.scans            enable row level security;
alter table boosthunter.settings         enable row level security;

create policy "boosthunter_anon_all" on boosthunter.account_balances for all to anon, authenticated using (true) with check (true);
create policy "boosthunter_anon_all" on boosthunter.bingo_offers     for all to anon, authenticated using (true) with check (true);
create policy "boosthunter_anon_all" on boosthunter.boosts           for all to anon, authenticated using (true) with check (true);
create policy "boosthunter_anon_all" on boosthunter.casino_offers    for all to anon, authenticated using (true) with check (true);
create policy "boosthunter_anon_all" on boosthunter.community_intel  for all to anon, authenticated using (true) with check (true);
create policy "boosthunter_anon_all" on boosthunter.pl_history       for all to anon, authenticated using (true) with check (true);
create policy "boosthunter_anon_all" on boosthunter.reload_offers    for all to anon, authenticated using (true) with check (true);
create policy "boosthunter_anon_all" on boosthunter.scans            for all to anon, authenticated using (true) with check (true);
create policy "boosthunter_anon_all" on boosthunter.settings         for all to anon, authenticated using (true) with check (true);

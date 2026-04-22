-- Enable Row-Level Security on public tables created outside of tracked migrations.
--
-- Context: the shared Supabase project (modjoikyuhqzouxvieua) hosts tables for several
-- sibling codebases (Peter bot, Second Brain, Octopus energy, health tracking, meal
-- planning, etc.). Those projects created tables ad-hoc via the dashboard SQL editor
-- and never enabled RLS, so Supabase's Security Advisor raised `rls_disabled_in_public`.
--
-- Fix: enable RLS with no policies. service_role (used by every known consumer of these
-- tables — verified via cross-repo audit 2026-04-22) bypasses RLS, so existing server-
-- side integrations are unaffected. Anon and authenticated reads, which were never
-- intended to reach these tables, are now blocked by default.
--
-- Tables that already have RLS enabled in sibling migrations (chat_messages, golden_tickets,
-- players, tournaments, knowledge_*, reminders, etc.) are deliberately excluded here so
-- we don't collide with their policy definitions.
--
-- Baseline probe: docs/security/rls-baseline-2026-04-22.tsv

alter table public.energy_billing         enable row level security;
alter table public.energy_consumption     enable row level security;
alter table public.energy_daily_summary   enable row level security;
alter table public.energy_tariffs         enable row level security;
alter table public.evening_clubs          enable row level security;
alter table public.gemini_api_usage       enable row level security;
alter table public.investment_model_runs  enable row level security;
alter table public.investment_training_data enable row level security;
alter table public.meal_favourites        enable row level security;
alter table public.meal_history           enable row level security;
alter table public.meal_plan_ingredients  enable row level security;
alter table public.meal_plan_items        enable row level security;
alter table public.meal_plan_preferences  enable row level security;
alter table public.meal_plan_templates    enable row level security;
alter table public.meal_plans             enable row level security;
alter table public.meal_presets           enable row level security;
alter table public.nutrition_logs         enable row level security;
alter table public.school_spellings       enable row level security;
alter table public.shopify_sync_queue     enable row level security;
alter table public.shopping_staples       enable row level security;
alter table public.spelling_sentences     enable row level security;
alter table public.spelling_test_results  enable row level security;
alter table public.task_attachments       enable row level security;
alter table public.task_categories        enable row level security;
alter table public.task_category_links    enable row level security;
alter table public.task_comments          enable row level security;
alter table public.task_history           enable row level security;
alter table public.task_reminders         enable row level security;
alter table public.tasks                  enable row level security;
alter table public.user_goals             enable row level security;
alter table public.vinted_collections_reported enable row level security;
alter table public.weight_readings        enable row level security;
alter table public.youtube_shown_videos   enable row level security;

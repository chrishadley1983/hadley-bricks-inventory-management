-- Resolve Supabase Security Advisor `security_definer_view` warnings.
--
-- When a view is owned by the `postgres` role and `security_invoker` is not set,
-- Postgres runs queries against the view using the OWNER's privileges, bypassing
-- RLS on the underlying tables. The advisor flags this as a security risk because
-- any user with SELECT on the view can indirectly read data their own RLS policies
-- would normally hide.
--
-- Fix: set `security_invoker = true` so each view respects the caller's RLS.
-- Idempotent. Postgres preserves this option through `CREATE OR REPLACE VIEW`.
--
-- Impact assessment:
--  - service_role callers: unchanged (service_role bypasses RLS regardless)
--  - authenticated callers: results now scoped by RLS on underlying tables.
--    For this project (single-user) all data is scoped to Chris's auth.uid(),
--    so queries continue to return the same rows.
--  - anon callers: none of the 20 views are hit with the anon key in any known
--    consumer (inventory app, Peter bot, finance-tracker all use service_role
--    or authenticated sessions).

-- Views defined in this repo
alter view public.arbitrage_current_view       set (security_invoker = true);
alter view public.arbitrage_watchlist_stats    set (security_invoker = true);
alter view public.daily_platform_activity      set (security_invoker = true);
alter view public.ebay_sku_issues              set (security_invoker = true);
alter view public.inventory_items_with_age     set (security_invoker = true);
alter view public.monthly_platform_summary     set (security_invoker = true);
alter view public.platform_performance_view    set (security_invoker = true);
alter view public.purchase_roi_view            set (security_invoker = true);
alter view public.seeded_asin_pricing          set (security_invoker = true);
alter view public.seeded_discovery_summary     set (security_invoker = true);
alter view public.user_seeded_arbitrage_items  set (security_invoker = true);

-- Views created via dashboard / sibling projects (Peter bot, finance-tracker).
-- Fixed here because the Supabase linter flags them regardless of origin and all
-- their consumers use service_role (unaffected) or authenticated contexts that
-- are already scoped to Chris's auth.uid().
alter view public.seeded_asins_with_sets set (security_invoker = true);
alter view public.spending_summary       set (security_invoker = true);
alter view public.v_active_research      set (security_invoker = true);
alter view public.v_amazon_latest_price  set (security_invoker = true);
alter view public.v_chris_active_todos   set (security_invoker = true);
alter view public.v_heartbeat_plan       set (security_invoker = true);
alter view public.v_peter_available_work set (security_invoker = true);
alter view public.v_profit_per_sale      set (security_invoker = true);
alter view public.v_unprocessed_ideas    set (security_invoker = true);

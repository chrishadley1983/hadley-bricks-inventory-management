-- Aggregate Bricqer snapshot stats in Postgres for the dashboard widget.
-- Lot definition matches the manual scan: distinct (item, colour, condition,
-- comment) among rows with quantity > 0.
-- SECURITY INVOKER: RLS on bricqer_inventory_snapshot scopes rows to the
-- calling user; p_user_id narrows further (and lets service-role callers scope).

create or replace function public.get_bricqer_snapshot_stats(p_user_id uuid)
returns table (
  lot_count bigint,
  piece_count bigint,
  inventory_value numeric,
  last_synced timestamptz
)
language sql
stable
as $$
  select
    count(distinct item_number || '|' || coalesce(color_id::text, '') || '|'
          || coalesce(condition, '') || '|' || coalesce(comment, '')) as lot_count,
    coalesce(sum(quantity), 0)::bigint as piece_count,
    coalesce(round(sum(quantity * coalesce(bricqer_price, 0))::numeric, 2), 0) as inventory_value,
    max(synced_at) as last_synced
  from public.bricqer_inventory_snapshot
  where user_id = p_user_id
    and quantity > 0;
$$;;

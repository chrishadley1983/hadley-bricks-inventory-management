-- Canonicalize inventory_items.status and prevent mixed-case regressions.
-- Applied after the 2026-07-09 dashboard deploy (writers now uppercase-only).

update public.inventory_items
set status = 'NOT YET RECEIVED', updated_at = now()
where status = 'Not Yet Received';

alter table public.inventory_items
  add constraint chk_inventory_status
  check (
    status is null
    or status in ('NOT YET RECEIVED', 'BACKLOG', 'LISTED', 'SOLD', 'RETURNED')
  );

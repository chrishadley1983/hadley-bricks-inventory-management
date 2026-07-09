-- Canonicalize inventory_items.status and prevent mixed-case regressions.
--
-- ORDERING: apply this migration only AFTER the code that writes
-- 'Not Yet Received' (review-queue approve + batch-import routes) is deployed
-- with the uppercase fix, otherwise those inserts will violate the constraint.
--
-- The bulk of the mixed-case rows are normalized via the InventoryService
-- script (_fix-nyr-status-case-2026-07-09.ts) so the Google Sheet mirror stays
-- in sync; the UPDATE below is a defensive catch-all for stragglers created
-- between the script run and this migration.

update public.inventory_items
set status = 'NOT YET RECEIVED', updated_at = now()
where status = 'Not Yet Received';

alter table public.inventory_items
  add constraint chk_inventory_status
  check (
    status is null
    or status in ('NOT YET RECEIVED', 'BACKLOG', 'LISTED', 'SOLD', 'RETURNED')
  );

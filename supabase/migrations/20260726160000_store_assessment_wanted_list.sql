-- Store assessment: persist a ready-to-upload BrickLink wanted list with each run.
--
-- WHY the CLI generates it and the page only serves it.
--
-- The engine scores every lot in the store but persists only a top-N slice per section
-- (12 buy-list / 15 fast-mover / 15 magnet / 20 set rows) into `assessment`. The full
-- scored set is discarded when the run ends. So a wanted list built from the persisted
-- blob would silently be a PARTIAL cart — Cover03 has 21 buyable lots and 12 saved rows —
-- and a partial cart that looks complete is worse than no export at all.
--
-- The CLI still holds every scored lot in memory at the point it writes this row, so it
-- generates the XML there, complete by construction. The web page links to the stored
-- text and never builds one of its own.
--
-- Rows written before this migration have NULL here; the UI says the run predates the
-- export rather than offering an empty download.

alter table public.store_assessments
  add column if not exists wanted_list_xml text,
  add column if not exists wanted_list_meta jsonb;

comment on column public.store_assessments.wanted_list_xml is
  'BrickLink wanted-list XML for the buyable lots passing the export filter, generated at '
  'scan time from the FULL scored set (see wanted_list_meta.min_str). Upload via BL '
  '"Upload Wanted List" — one entry per (item, colour), concrete CONDITION, MAXPRICE '
  'gated at break-even. NULL on runs predating 2026-07-26.';

comment on column public.store_assessments.wanted_list_meta is
  'Provenance for wanted_list_xml: {min_str, exclude_dups, entries, lots, outlay, net, '
  'merged_tuples, collapsed_rows, skipped[]}. Without it the XML is an unlabelled filter.';

-- Canonical BL<->Bricqer colour map (unified-price-cache feature, F1).
-- BL colour id is the canonical key. Built from BL getColors + Bricqer snapshot colours
-- joined by normalised name. See docs/features/unified-price-cache/spec.md §3.2.
create table if not exists public.bricklink_colour_map (
  bl_colour_id integer primary key,
  bl_colour_name text not null,
  bricqer_colour_id integer,
  bricqer_colour_name text,
  rgb text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_colour_map_bricqer on public.bricklink_colour_map(bricqer_colour_id);
alter table public.bricklink_colour_map enable row level security;
create policy "colour_map_read_authenticated" on public.bricklink_colour_map
  for select to authenticated using (true);
comment on table public.bricklink_colour_map is
  'Canonical BL<->Bricqer colour mapping. BL colour id is canonical. Built from BL getColors + Bricqer snapshot colours joined by normalised name. See docs/features/unified-price-cache.';

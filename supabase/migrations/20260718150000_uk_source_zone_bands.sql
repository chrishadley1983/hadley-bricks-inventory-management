-- UK as a first-class source zone in the intl set-arb (Chris 2026-07-18: the clean-start
-- page rebuild dropped the domestic BL->Amazon view; UK re-enters as a zone, not a rebuild).
-- Domestic parcels carry postage but no duty / import-VAT / customs handling. £4 base is a
-- placeholder like every other band — calibrate from a real multi-set UK order via
-- record-zone-actuals.ts.

update public.bl_import_zone_costs
set ship_base_gbp = 4,
    ship_per_100g_gbp = 0.15,
    notes = 'domestic — postage only, no import regime; bands placeholder until calibrated',
    updated_at = now()
where zone = 'UK' and calibrated_at is null;

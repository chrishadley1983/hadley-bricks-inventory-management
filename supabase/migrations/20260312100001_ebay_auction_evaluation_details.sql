-- Add evaluation details JSONB to scan log for debug visibility
ALTER TABLE ebay_auction_scan_log
ADD COLUMN IF NOT EXISTS evaluation_details JSONB;

-- Track Keepa API calls separately
ALTER TABLE ebay_auction_scan_log
ADD COLUMN IF NOT EXISTS keepa_calls_made INTEGER NOT NULL DEFAULT 0;

-- Force PostgREST schema cache reload (belt-and-braces — the event trigger
-- should fire automatically, but NOTIFY is fire-and-forget and can be missed
-- if PostgREST reconnects between the DDL and the NOTIFY delivery)
NOTIFY pgrst, 'reload schema';

-- Add evaluation details JSONB to scan log for debug visibility
ALTER TABLE ebay_auction_scan_log
ADD COLUMN IF NOT EXISTS evaluation_details JSONB;

-- Track Keepa API calls separately
ALTER TABLE ebay_auction_scan_log
ADD COLUMN IF NOT EXISTS keepa_calls_made INTEGER NOT NULL DEFAULT 0;

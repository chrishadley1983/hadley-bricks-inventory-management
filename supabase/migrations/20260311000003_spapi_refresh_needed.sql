-- Add spapi_refresh_needed flag to tracked_asins
-- Set to true when amazon sync completes a price update for an ASIN,
-- consumed by the spapi-buybox-refresh cron to do targeted SP-API checks.
ALTER TABLE tracked_asins ADD COLUMN IF NOT EXISTS spapi_refresh_needed boolean DEFAULT false;

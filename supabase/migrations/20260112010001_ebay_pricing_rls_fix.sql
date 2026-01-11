-- Fix RLS policies for ebay_pricing table
-- The original migration only allowed SELECT for authenticated users,
-- but the sync service runs as authenticated user and needs INSERT/UPDATE

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Authenticated users can view eBay pricing" ON ebay_pricing;
DROP POLICY IF EXISTS "Service role can manage eBay pricing" ON ebay_pricing;

-- Authenticated users can read all eBay pricing (shared data)
CREATE POLICY "Authenticated users can view eBay pricing"
  ON ebay_pricing FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert eBay pricing (for sync jobs)
CREATE POLICY "Authenticated users can insert eBay pricing"
  ON ebay_pricing FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated users can update eBay pricing (for sync jobs)
CREATE POLICY "Authenticated users can update eBay pricing"
  ON ebay_pricing FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Service role can manage all records (for background jobs if needed)
CREATE POLICY "Service role can manage eBay pricing"
  ON ebay_pricing FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

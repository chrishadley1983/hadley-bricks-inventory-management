-- Migration: Fix negotiation offer statuses
--
-- This migration fixes existing negotiation offers by:
-- 1. Marking offers as ACCEPTED where an eBay order exists at the offer price
-- 2. Marking offers as EXPIRED where the expiry date has passed
--
-- Background: The syncOfferStatuses function wasn't being called automatically,
-- so all 222 existing offers remained in PENDING status even though some were
-- accepted (confirmed by orders) and many had expired.

-- Step 1: Mark accepted offers (order exists at offer price, placed after offer was sent)
-- We match offers to orders where:
-- - The listing ID matches
-- - The order was placed after the offer was sent
-- - The order price matches the offer price (within 1p tolerance)

WITH accepted_offers AS (
  SELECT DISTINCT no.id
  FROM negotiation_offers no
  JOIN ebay_order_line_items eli ON eli.legacy_item_id = no.ebay_listing_id
  JOIN ebay_orders eo ON eo.id = eli.order_id AND eo.user_id = no.user_id
  WHERE no.status = 'PENDING'
    AND eo.creation_date >= no.sent_at
    AND ABS(eli.line_item_cost_amount - no.offer_price) <= 0.01
)
UPDATE negotiation_offers
SET
  status = 'ACCEPTED',
  status_updated_at = NOW()
WHERE id IN (SELECT id FROM accepted_offers);

-- Log how many were updated (will show in migration output)
DO $$
DECLARE
  accepted_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO accepted_count
  FROM negotiation_offers
  WHERE status = 'ACCEPTED' AND status_updated_at >= NOW() - INTERVAL '1 minute';

  RAISE NOTICE 'Marked % offers as ACCEPTED', accepted_count;
END $$;

-- Step 2: Mark expired offers (past expiry date, still PENDING)
UPDATE negotiation_offers
SET
  status = 'EXPIRED',
  status_updated_at = NOW()
WHERE status = 'PENDING'
  AND expires_at < NOW();

-- Log how many were updated
DO $$
DECLARE
  expired_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO expired_count
  FROM negotiation_offers
  WHERE status = 'EXPIRED' AND status_updated_at >= NOW() - INTERVAL '1 minute';

  RAISE NOTICE 'Marked % offers as EXPIRED', expired_count;
END $$;

-- Step 3: Log final status distribution
DO $$
DECLARE
  status_row RECORD;
BEGIN
  RAISE NOTICE '--- Final offer status distribution ---';
  FOR status_row IN
    SELECT status, COUNT(*) as count
    FROM negotiation_offers
    GROUP BY status
    ORDER BY count DESC
  LOOP
    RAISE NOTICE '%: %', status_row.status, status_row.count;
  END LOOP;
END $$;

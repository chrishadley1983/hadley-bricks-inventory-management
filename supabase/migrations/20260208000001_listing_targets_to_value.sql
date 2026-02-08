-- Convert eBay/Amazon listing targets from count-based (INTEGER) to value-based (DECIMAL)
-- eBay target: £735/week, Amazon target: £1,050/week

ALTER TABLE workflow_config
  ALTER COLUMN target_ebay_listings TYPE DECIMAL(10,2),
  ALTER COLUMN target_amazon_listings TYPE DECIMAL(10,2);

ALTER TABLE workflow_config
  ALTER COLUMN target_ebay_listings SET DEFAULT 735,
  ALTER COLUMN target_amazon_listings SET DEFAULT 1050;

-- Update existing rows with agreed value targets
UPDATE workflow_config
  SET target_ebay_listings = 735,
      target_amazon_listings = 1050,
      updated_at = NOW();

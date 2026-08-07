-- Allow Shopify pick list snapshots alongside Amazon and eBay
ALTER TABLE picklist_snapshots DROP CONSTRAINT picklist_snapshots_platform_check;
ALTER TABLE picklist_snapshots ADD CONSTRAINT picklist_snapshots_platform_check
  CHECK (platform IN ('amazon', 'ebay', 'shopify'));

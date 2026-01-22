-- Add Manifest parcels and Post parcels as daily task definitions
-- Migration: 20260121145230_add_manifest_post_parcels_daily_tasks
-- Purpose: Add shipping tasks that should appear daily in the task queue

-- ============================================================================
-- ADD DAILY TASK DEFINITIONS FOR ALL EXISTING USERS
-- ============================================================================

-- Insert "Manifest parcels" as a daily task for all users who have workflow data
INSERT INTO workflow_task_definitions (
  user_id,
  name,
  description,
  category,
  icon,
  frequency,
  ideal_time,
  priority,
  estimated_minutes,
  deep_link_url,
  count_source,
  is_system,
  sort_order
)
SELECT
  DISTINCT user_id,
  'Manifest parcels',
  'Create shipping manifests for parcels to be dispatched',
  'Shipping',
  '📦',
  'daily',
  'AM',
  2,  -- IMPORTANT priority (after ship orders)
  15,
  NULL,
  NULL,
  TRUE,
  4  -- After the first 3 critical tasks
FROM workflow_task_definitions
WHERE NOT EXISTS (
  SELECT 1 FROM workflow_task_definitions wtd2
  WHERE wtd2.user_id = workflow_task_definitions.user_id
  AND wtd2.name = 'Manifest parcels'
);

-- Insert "Post parcels" as a daily task for all users who have workflow data
INSERT INTO workflow_task_definitions (
  user_id,
  name,
  description,
  category,
  icon,
  frequency,
  ideal_time,
  priority,
  estimated_minutes,
  deep_link_url,
  count_source,
  is_system,
  sort_order
)
SELECT
  DISTINCT user_id,
  'Post parcels',
  'Drop off parcels at post office or collection point',
  'Shipping',
  '📮',
  'daily',
  'AM',
  2,  -- IMPORTANT priority
  30,
  NULL,
  NULL,
  TRUE,
  5  -- After manifest parcels
FROM workflow_task_definitions
WHERE NOT EXISTS (
  SELECT 1 FROM workflow_task_definitions wtd2
  WHERE wtd2.user_id = workflow_task_definitions.user_id
  AND wtd2.name = 'Post parcels'
);

-- ============================================================================
-- UPDATE THE SEED FUNCTION FOR NEW USERS
-- ============================================================================

CREATE OR REPLACE FUNCTION seed_workflow_data(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Skip if user already has task definitions
  IF EXISTS (SELECT 1 FROM workflow_task_definitions WHERE user_id = p_user_id LIMIT 1) THEN
    RETURN;
  END IF;

  -- ============================================================================
  -- SYSTEM TASK DEFINITIONS
  -- ============================================================================

  -- CRITICAL Priority Tasks (Priority 1)
  INSERT INTO workflow_task_definitions (user_id, name, description, category, icon, frequency, ideal_time, priority, estimated_minutes, deep_link_url, count_source, is_system, sort_order)
  VALUES
    (p_user_id, 'Process orders / Ship', 'Pick, pack and ship orders awaiting dispatch', 'Shipping', '📦', 'daily', 'AM', 1, 45, '/orders?status=paid', 'orders.paid', TRUE, 1),
    (p_user_id, 'Resolve inventory matches', 'Review and resolve pending inventory matches from platform syncs', 'Admin', '🔗', 'daily', 'AM', 1, 15, '/settings/inventory-resolution', 'resolution.pending', TRUE, 2),
    (p_user_id, 'Sync all platforms', 'Synchronise orders and inventory from all connected platforms', 'Admin', '🔄', 'daily', 'AM', 1, 5, NULL, NULL, TRUE, 3);

  -- IMPORTANT Priority Tasks (Priority 2)
  INSERT INTO workflow_task_definitions (user_id, name, description, category, icon, frequency, ideal_time, priority, estimated_minutes, deep_link_url, count_source, is_system, sort_order)
  VALUES
    (p_user_id, 'Manifest parcels', 'Create shipping manifests for parcels to be dispatched', 'Shipping', '📦', 'daily', 'AM', 2, 15, NULL, NULL, TRUE, 4),
    (p_user_id, 'Post parcels', 'Drop off parcels at post office or collection point', 'Shipping', '📮', 'daily', 'AM', 2, 30, NULL, NULL, TRUE, 5),
    (p_user_id, 'Arbitrage check (AM)', 'Morning check for arbitrage opportunities across platforms', 'Sourcing', '📊', 'daily', 'AM', 2, 20, '/arbitrage/amazon', NULL, TRUE, 10),
    (p_user_id, 'Arbitrage check (PM)', 'Evening check for arbitrage opportunities across platforms', 'Sourcing', '📊', 'daily', 'PM', 2, 20, '/arbitrage/amazon', NULL, TRUE, 11),
    (p_user_id, 'List from backlog', 'Create new listings from items in the backlog', 'Listing', '📝', 'daily', 'ANY', 2, 180, '/inventory?status=BACKLOG', 'inventory.backlog', TRUE, 12);

  -- REGULAR Priority Tasks (Priority 3) - WITH frequency_days
  INSERT INTO workflow_task_definitions (user_id, name, description, category, icon, frequency, frequency_days, ideal_time, priority, estimated_minutes, deep_link_url, count_source, is_system, sort_order)
  VALUES
    (p_user_id, 'Categorise Monzo transactions', 'Review and categorise uncategorised Monzo transactions', 'Admin', '💳', 'twice_weekly', ARRAY[1,4], 'ANY', 3, 12, '/transactions?tab=monzo&filter=uncategorised', 'transactions.uncategorised', TRUE, 20),
    (p_user_id, 'Review slow-moving inventory', 'Identify and action stale inventory items', 'Listing', '⏰', 'weekly', ARRAY[1], 'ANY', 3, 25, '/reports/inventory-aging', 'inventory.stale', TRUE, 21),
    (p_user_id, 'Send buyer discount offers', 'Send promotional offers to watchers and potential buyers', 'Listing', '🏷️', 'twice_weekly', ARRAY[2,5], 'ANY', 3, 12, '/listing-assistant?tab=offers', NULL, TRUE, 22),
    (p_user_id, 'Refresh old eBay listings', 'Refresh eBay listings to boost visibility', 'Listing', '🔄', 'weekly', ARRAY[3], 'ANY', 3, 25, '/listing-assistant?tab=refresh', 'ebay.refresh_eligible', TRUE, 23),
    (p_user_id, 'Review Amazon repricing', 'Check and adjust Amazon repricing rules and results', 'Listing', '💰', 'weekly', ARRAY[2], 'ANY', 3, 18, '/repricing', NULL, TRUE, 24),
    (p_user_id, 'Analyse low-score listings', 'Review and improve listings with low optimisation scores', 'Listing', '⭐', 'weekly', ARRAY[4], 'ANY', 3, 25, '/listing-assistant', 'listings.low_score', TRUE, 26);

  -- REGULAR Priority Tasks (Priority 3) - WITHOUT frequency_days (daily tasks)
  INSERT INTO workflow_task_definitions (user_id, name, description, category, icon, frequency, ideal_time, priority, estimated_minutes, deep_link_url, count_source, is_system, sort_order)
  VALUES
    (p_user_id, 'Push Amazon price changes', 'Submit pending price changes to Amazon', 'Listing', '📤', 'daily', 'ANY', 3, 8, '/amazon-sync', 'amazon_sync.pending', TRUE, 25);

  -- LOW Priority Tasks (Priority 4)
  INSERT INTO workflow_task_definitions (user_id, name, description, category, icon, frequency, frequency_days, ideal_time, priority, estimated_minutes, deep_link_url, count_source, is_system, sort_order)
  VALUES
    (p_user_id, 'Review platform performance', 'Analyse sales performance across platforms', 'Admin', '📈', 'weekly', ARRAY[5], 'ANY', 4, 18, '/reports/platform-performance', NULL, TRUE, 30),
    (p_user_id, 'Monthly P&L review', 'Review profit and loss for the previous month', 'Admin', '📊', 'monthly', NULL, 'ANY', 4, 38, '/reports/profit-loss?period=lastMonth', NULL, TRUE, 31),
    (p_user_id, 'Inventory valuation check', 'Review current inventory valuation and trends', 'Admin', '💎', 'monthly', NULL, 'ANY', 4, 18, '/reports/inventory-valuation', NULL, TRUE, 32),
    (p_user_id, 'Review purchase ROI', 'Analyse return on investment for recent purchases', 'Admin', '📉', 'monthly', NULL, 'ANY', 4, 25, '/reports/purchase-analysis', NULL, TRUE, 33),
    (p_user_id, 'Discover new ASINs (seeded)', 'Find new potential products via seeded ASIN discovery', 'Sourcing', '🌱', 'monthly', NULL, 'ANY', 4, 38, '/arbitrage/amazon?tab=seeded', NULL, TRUE, 34),
    (p_user_id, 'Re-analyse listing scores', 'Refresh listing optimisation scores for stale analyses', 'Listing', '🔍', 'quarterly', NULL, 'ANY', 4, 38, '/listing-assistant?reanalyse=stale', NULL, TRUE, 35),
    (p_user_id, 'Review Amazon stock discrepancies', 'Compare and reconcile Amazon stock levels', 'Admin', '🔎', 'biannual', NULL, 'ANY', 4, 52, '/platform-stock?compare=true', NULL, TRUE, 36),
    (p_user_id, 'Review eBay stock discrepancies', 'Compare and reconcile eBay stock levels', 'Admin', '🔎', 'biannual', NULL, 'ANY', 4, 52, '/ebay-stock?compare=true', NULL, TRUE, 37);

  -- ============================================================================
  -- OFF-SYSTEM TASK PRESETS
  -- ============================================================================
  INSERT INTO off_system_task_presets (user_id, name, icon, category, default_duration_minutes, default_priority, sort_order)
  VALUES
    (p_user_id, 'Photography session', '📷', 'Listing', 120, 3, 1),
    (p_user_id, 'Returns processing', '🔄', 'Shipping', 30, 2, 2),
    (p_user_id, 'Returns inspection', '🔍', 'Shipping', 20, 3, 3),
    (p_user_id, 'Packing supplies run', '🛒', 'Admin', 45, 3, 4),
    (p_user_id, 'Storage organisation', '🗄️', 'Admin', 60, 4, 5),
    (p_user_id, 'Bank deposit', '🏦', 'Admin', 20, 3, 6),
    (p_user_id, 'Auction attendance', '🔨', 'Sourcing', 180, 3, 7),
    (p_user_id, 'Car boot sale', '🚗', 'Sourcing', 180, 3, 8);

  -- Create default workflow config
  INSERT INTO workflow_config (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- REMOVE MANIFEST/POST PARCELS FROM OFF-SYSTEM PRESETS (now daily tasks)
-- ============================================================================
DELETE FROM off_system_task_presets
WHERE name IN ('Manifest parcels', 'Post parcels');

-- ============================================================================
-- COMMENT
-- ============================================================================
COMMENT ON FUNCTION seed_workflow_data(UUID) IS 'Seeds default workflow task definitions and off-system task presets for a new user. Called when user first accesses the workflow page. Updated to include Manifest parcels and Post parcels as daily tasks.';

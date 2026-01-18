export * from './types';
export * from './platforms';
import type { Tables, TablesInsert, TablesUpdate } from './types';

// Convenience type aliases for common tables
export type InventoryItem = Tables<'inventory_items'>;
export type InventoryItemInsert = TablesInsert<'inventory_items'>;
export type InventoryItemUpdate = TablesUpdate<'inventory_items'>;

// Inventory status type (based on actual usage in the app - some values are uppercase, some title case)
export type InventoryStatus =
  | 'In Stock' | 'IN STOCK'
  | 'Listed' | 'LISTED'
  | 'Sold' | 'SOLD'
  | 'Shipped' | 'SHIPPED'
  | 'Archived' | 'ARCHIVED'
  | 'Backlog' | 'BACKLOG'
  | 'Returned' | 'RETURNED'
  | 'NOT YET RECEIVED';

export type Purchase = Tables<'purchases'>;
export type PurchaseInsert = TablesInsert<'purchases'>;
export type PurchaseUpdate = TablesUpdate<'purchases'>;

export type MileageTracking = Tables<'mileage_tracking'>;
export type MileageTrackingInsert = TablesInsert<'mileage_tracking'>;
export type MileageTrackingUpdate = TablesUpdate<'mileage_tracking'>;

export type PlatformOrder = Tables<'platform_orders'>;
export type PlatformOrderInsert = TablesInsert<'platform_orders'>;
export type PlatformOrderUpdate = TablesUpdate<'platform_orders'>;

export type OrderItem = Tables<'order_items'>;
export type OrderItemInsert = TablesInsert<'order_items'>;
export type OrderItemUpdate = TablesUpdate<'order_items'>;

export type Profile = Tables<'profiles'>;
export type ProfileInsert = TablesInsert<'profiles'>;
export type ProfileUpdate = TablesUpdate<'profiles'>;

export type PlatformCredentials = Tables<'platform_credentials'>;
export type PlatformCredentialsInsert = TablesInsert<'platform_credentials'>;
export type PlatformCredentialsUpdate = TablesUpdate<'platform_credentials'>;

// Order status type (normalized status values used in the UI)
export type OrderStatus = 'Pending' | 'Paid' | 'Packed' | 'Shipped' | 'Completed' | 'Cancelled';

// Sales types
export type Sale = Tables<'sales'>;
export type SaleInsert = TablesInsert<'sales'>;
export type SaleUpdate = TablesUpdate<'sales'>;
export type SaleItem = Tables<'sale_items'>;
export type SaleItemInsert = TablesInsert<'sale_items'>;
export type SaleItemUpdate = TablesUpdate<'sale_items'>;

// Order status history
export type OrderStatusHistory = Tables<'order_status_history'>;
export type OrderStatusHistoryInsert = TablesInsert<'order_status_history'>;

// Platform type - now exported from ./platforms
// (kept here as comment for reference: 'bricklink' | 'brickowl' | 'bricqer' | 'ebay' | 'amazon')

// Item condition type
export type ItemCondition = 'New' | 'Used';

// Cache metadata
export type CacheMetadata = Tables<'cache_metadata'>;
export type CacheMetadataInsert = TablesInsert<'cache_metadata'>;
export type CacheMetadataUpdate = TablesUpdate<'cache_metadata'>;

// Sync audit log
export type SyncAuditLog = Tables<'sync_audit_log'>;
export type SyncAuditLogInsert = TablesInsert<'sync_audit_log'>;

// eBay types
export type EbayCredentials = Tables<'ebay_credentials'>;
export type EbayCredentialsInsert = TablesInsert<'ebay_credentials'>;
export type EbayCredentialsUpdate = TablesUpdate<'ebay_credentials'>;
export type EbayOrder = Tables<'ebay_orders'>;
export type EbayOrderLineItem = Tables<'ebay_order_line_items'>;
export type EbayTransaction = Tables<'ebay_transactions'>;
export type EbayPayout = Tables<'ebay_payouts'>;
export type EbaySkuMapping = Tables<'ebay_sku_mappings'>;

// eBay marketplace IDs
export type EbayMarketplaceId = 'EBAY_GB' | 'EBAY_US' | 'EBAY_DE' | 'EBAY_FR' | 'EBAY_IT' | 'EBAY_ES' | 'EBAY_AU';

// Bricqer stats cache
export type BricqerStatsCache = Tables<'bricqer_stats_cache'>;

// Aliases for backwards compatibility (singular names)
export type PlatformCredential = PlatformCredentials;
export type PlatformCredentialInsert = PlatformCredentialsInsert;
export type PlatformCredentialUpdate = PlatformCredentialsUpdate;

// Workflow types
export type WorkflowConfig = Tables<'workflow_config'>;
export type WorkflowConfigInsert = TablesInsert<'workflow_config'>;
export type WorkflowConfigUpdate = TablesUpdate<'workflow_config'>;

export type WorkflowTaskDefinition = Tables<'workflow_task_definitions'>;
export type WorkflowTaskDefinitionInsert = TablesInsert<'workflow_task_definitions'>;
export type WorkflowTaskDefinitionUpdate = TablesUpdate<'workflow_task_definitions'>;

export type WorkflowTaskInstance = Tables<'workflow_task_instances'>;
export type WorkflowTaskInstanceInsert = TablesInsert<'workflow_task_instances'>;
export type WorkflowTaskInstanceUpdate = TablesUpdate<'workflow_task_instances'>;

export type OffSystemTaskPreset = Tables<'off_system_task_presets'>;
export type OffSystemTaskPresetInsert = TablesInsert<'off_system_task_presets'>;
export type OffSystemTaskPresetUpdate = TablesUpdate<'off_system_task_presets'>;

// Task status type
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'deferred';

// Task priority type
export type TaskPriority = 1 | 2 | 3 | 4; // 1=Critical, 2=Important, 3=Regular, 4=Low

// Task frequency type
export type TaskFrequency = 'daily' | 'twice_daily' | 'twice_weekly' | 'weekly' | 'monthly' | 'quarterly' | 'biannual' | 'adhoc';

// Task category type
export type TaskCategory = 'Development' | 'Listing' | 'Shipping' | 'Sourcing' | 'Admin' | 'Other';

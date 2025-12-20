/**
 * Platform Adapter Interface
 *
 * Defines a common interface for all platform adapters (BrickLink, Brick Owl, etc.).
 * This enables unified order syncing across multiple platforms.
 */

import type { Platform } from '@hadley-bricks/database';

/**
 * Parameters for fetching orders from a platform
 */
export interface OrderFetchParams {
  /** Filter by order status(es) */
  status?: string[];
  /** Minimum order date */
  fromDate?: Date;
  /** Maximum order date */
  toDate?: Date;
  /** Maximum number of orders to fetch */
  limit?: number;
  /** Include archived/filed orders */
  includeArchived?: boolean;
  /** Include order item details (may require additional API calls) */
  includeItems?: boolean;
}

/**
 * Normalized buyer information
 */
export interface BuyerInfo {
  name: string;
  email?: string;
  username?: string;
}

/**
 * Normalized address structure
 */
export interface Address {
  name: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode: string;
}

/**
 * Normalized order item
 */
export interface PlatformOrderItem {
  itemNumber: string;
  itemName: string;
  itemType: string;
  colorId?: number;
  colorName?: string;
  quantity: number;
  condition: 'New' | 'Used';
  unitPrice: number;
  totalPrice: number;
  currency: string;
}

/**
 * Normalized order from any platform
 */
export interface PlatformOrder {
  platformOrderId: string;
  platform: Platform;
  status: string;
  buyer: BuyerInfo;
  shippingAddress?: Address;
  items: PlatformOrderItem[];
  subtotal: number;
  shippingCost: number;
  fees: number;
  total: number;
  currency: string;
  orderDate: Date;
  paymentDate?: Date;
  shippedDate?: Date;
  trackingNumber?: string;
  rawData: unknown;
}

/**
 * Result from a sync operation
 */
export interface SyncResult {
  success: boolean;
  platform: Platform;
  ordersProcessed: number;
  ordersCreated: number;
  ordersUpdated: number;
  errors: string[];
  lastSyncedAt: Date;
}

/**
 * Sync status for a platform
 */
export interface PlatformSyncStatus {
  platform: Platform;
  isConfigured: boolean;
  totalOrders: number;
  lastSyncedAt: Date | null;
  connectionStatus: 'connected' | 'disconnected' | 'error';
  errorMessage?: string;
}

/**
 * Platform Adapter Interface
 *
 * All platform-specific adapters (BrickLink, Brick Owl, etc.) should implement this interface.
 */
export interface PlatformAdapter {
  /** The platform identifier */
  readonly platform: Platform;

  /**
   * Test the connection using stored credentials
   * @param userId The user ID
   * @returns true if connection is successful
   */
  testConnection(userId: string): Promise<boolean>;

  /**
   * Check if the platform is configured for a user
   * @param userId The user ID
   */
  isConfigured(userId: string): Promise<boolean>;

  /**
   * Fetch orders from the platform
   * @param userId The user ID
   * @param params Optional fetch parameters
   */
  fetchOrders(userId: string, params?: OrderFetchParams): Promise<PlatformOrder[]>;

  /**
   * Fetch a single order by platform order ID
   * @param userId The user ID
   * @param orderId The platform-specific order ID
   */
  fetchOrder(userId: string, orderId: string): Promise<PlatformOrder>;

  /**
   * Sync orders from the platform to the database
   * @param userId The user ID
   * @param options Sync options
   */
  syncOrders(userId: string, options?: OrderFetchParams): Promise<SyncResult>;

  /**
   * Get the sync status for this platform
   * @param userId The user ID
   */
  getSyncStatus(userId: string): Promise<PlatformSyncStatus>;
}

/**
 * Options for the unified order sync
 */
export interface UnifiedSyncOptions {
  /** Platforms to sync (defaults to all configured platforms) */
  platforms?: Platform[];
  /** Include archived/filed orders */
  includeArchived?: boolean;
  /** Include order item details */
  includeItems?: boolean;
  /** Force full sync (ignore last sync time) */
  fullSync?: boolean;
}

/**
 * Result from a unified sync across multiple platforms
 */
export interface UnifiedSyncResult {
  success: boolean;
  results: Map<Platform, SyncResult>;
  totalOrdersProcessed: number;
  totalOrdersCreated: number;
  totalOrdersUpdated: number;
  errors: string[];
  syncedAt: Date;
}

/**
 * Amazon Inventory Linking Service
 *
 * Links Amazon order items to inventory items when orders are shipped.
 * Two modes of operation:
 * 1. Pick List Mode - inventory_item_id already populated from fulfillment workflow
 * 2. Non-Pick List Mode - must find inventory by ASIN match (FIFO selection)
 *
 * Key differences from eBay:
 * - Uses ASIN instead of SKU for matching
 * - Auto-handles multi-quantity orders (FIFO selection)
 * - Works with platform_orders + order_items tables
 * - Gets financials from amazon_transactions table
 *
 * @see docs/plans/amazon-inventory-linking.md
 */

import { createClient as createServerClient } from '@/lib/supabase/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { archiveShopifyOnSold } from '@/lib/shopify/archive-on-sold';
import { fetchAllRecords } from '@/lib/supabase/pagination';
import { discordService } from '@/lib/notifications';

// ============================================================================
// Types
// ============================================================================

export interface AmazonMatchResult {
  status: 'matched' | 'manual_required' | 'unmatched';
  method?: 'auto_picklist' | 'auto_asin' | 'manual';
  inventoryIds?: string[];
  confidence?: number;
  reason?: AmazonResolutionReason;
  candidates?: RankedCandidate[];
  quantityNeeded?: number;
  quantityMatched?: number;
}

export type AmazonResolutionReason =
  | 'no_asin'
  | 'no_matches'
  | 'insufficient_inventory'
  | 'already_linked'
  | 'multiple_asin_matches'
  | 'picklist_mismatch';

export interface RankedCandidate {
  id: string;
  amazon_asin: string | null;
  set_number: string | null;
  item_name: string | null;
  condition: string | null;
  storage_location: string | null;
  listing_value: number | null;
  cost: number | null;
  purchase_date: string | null;
  created_at: string;
  status: string;
  score: number;
  reasons: string[];
}

export interface AmazonNetSaleCalculation {
  grossAmount: number;
  feesAmount: number | null;
  netAmount: number | null;
  referralFee: number | null;
  fbaFee: number | null;
  status: 'calculated' | 'pending_transaction' | 'no_transaction';
}

export interface LinkingResult {
  orderId: string;
  status: 'complete' | 'partial' | 'pending';
  orderItemsProcessed: number;
  autoLinked: number;
  queuedForResolution: number;
  errors: string[];
}

export interface BulkLinkingResult {
  ordersProcessed: number;
  ordersComplete: number;
  ordersPartial: number;
  ordersPending: number;
  totalAutoLinked: number;
  totalQueuedForResolution: number;
  errors: string[];
}

export interface ProcessingOptions {
  mode?: 'picklist' | 'non_picklist' | 'auto';
  includeSold?: boolean;
  onProgress?: (current: number, total: number, autoLinked: number, queued: number) => void;
}

interface OrderItem {
  id: string;
  order_id: string;
  item_number: string; // ASIN
  item_name: string | null;
  quantity: number;
  total_price: number | null;
  unit_price: number | null;
  inventory_item_id: string | null;
  amazon_linked_at: string | null;
}

interface PlatformOrder {
  id: string;
  user_id: string;
  platform: string;
  platform_order_id: string;
  order_date: string | null;
  status: string | null;
  internal_status: string | null;
  inventory_link_status: string | null;
  fulfilled_at: string | null;
  shipped_at: string | null;
  total: number | null;
}

interface InventoryItem {
  id: string;
  amazon_asin: string | null;
  set_number: string | null;
  item_name: string | null;
  condition: string | null;
  storage_location: string | null;
  listing_value: number | null;
  listing_platform: string | null;
  cost: number | null;
  purchase_date: string | null;
  created_at: string;
  status: string;
  amazon_order_item_id: string | null;
}

// ============================================================================
// Phantom-stock reconciliation (the Amazon analogue of Shopify archive-drift)
// ============================================================================

/** A unit still shown as available that may actually have sold. */
export interface PhantomInStockUnit {
  id: string;
  sku: string | null;
  set_number: string | null;
  item_name: string | null;
  amazon_asin: string | null;
  listing_date: string | null; // YYYY-MM-DD
  listing_value: number | null;
}

/** A shipped order line that has fewer linked units than it sold. */
export interface PhantomUncoveredOrder {
  platformOrderId: string;
  orderDate: string; // ISO timestamp
  short: number; // units shipped but not linked to any inventory unit
  perUnit: number | null; // estimated per-unit sale value
}

export interface PhantomCandidate {
  unit: PhantomInStockUnit;
  order: PhantomUncoveredOrder;
}

/**
 * Assign uncovered shipped units to in-stock units that are genuine phantoms.
 *
 * Pure (no DB) so it can be unit-tested. Rules, per ASIN:
 *  - Only a unit whose `listing_date` is on/before the sale date can be the unit
 *    that sold (chronology guard — a unit listed after the sale is real stock).
 *  - FIFO: oldest-listed units fill oldest uncovered orders first.
 *  - Cap matches per ASIN at the number of uncovered "slots" so we never flag
 *    more units than actually went missing (avoids over-flagging when an ASIN
 *    has many in-stock units and one stray uncovered sale).
 */
export function assignPhantomCandidates(
  inStockByAsin: Map<string, PhantomInStockUnit[]>,
  uncoveredByAsin: Map<string, PhantomUncoveredOrder[]>
): PhantomCandidate[] {
  const out: PhantomCandidate[] = [];

  for (const [asin, orders] of uncoveredByAsin) {
    const units = (inStockByAsin.get(asin) ?? [])
      .slice()
      .sort((a, b) => (a.listing_date ?? '9999').localeCompare(b.listing_date ?? '9999'));
    if (units.length === 0) continue;

    // One slot per missing unit, oldest order first.
    const slots = orders
      .slice()
      .sort((a, b) => a.orderDate.localeCompare(b.orderDate))
      .flatMap((o) => Array.from({ length: Math.max(0, o.short) }, () => o));

    const used = new Set<string>();
    for (const slot of slots) {
      const saleDay = slot.orderDate.slice(0, 10);
      const unit = units.find(
        (u) => !used.has(u.id) && (u.listing_date ?? '9999') <= saleDay
      );
      if (!unit) continue; // no plausible (early-enough) unit left → historical
      used.add(unit.id);
      out.push({ unit, order: slot });
    }
  }

  return out;
}

export interface PhantomReconcileResult {
  checkedOrders: number;
  uncoveredUnits: number;
  phantoms: PhantomCandidate[];
  /**
   * "Self-covering" phantoms: units that are LISTED/BACKLOG yet still carry their
   * OWN sold_order_id (they sold but were wrongly re-listed). These are invisible
   * to the per-ASIN coverage math (a unit covers its own order), so they need a
   * dedicated check. High-confidence — the unit already holds the sale record.
   */
  selfCovering: PhantomInStockUnit[];
  alerted: boolean;
}

// ============================================================================
// Service Class
// ============================================================================

export class AmazonInventoryLinkingService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private supabase: any;
  private userId: string;
  private includeSold: boolean = false;

  constructor(supabase: SupabaseClient, userId: string) {
    this.supabase = supabase;
    this.userId = userId;
  }

  /**
   * Get the valid statuses for inventory matching
   */
  private getValidStatuses(): string[] {
    if (this.includeSold) {
      return ['BACKLOG', 'LISTED', 'SOLD'];
    }
    return ['BACKLOG', 'LISTED'];
  }

  // --------------------------------------------------------------------------
  // Main Entry Points
  // --------------------------------------------------------------------------

  /**
   * Process a shipped Amazon order - attempt to link all items to inventory
   * Automatically detects mode based on whether inventory_item_id is populated
   */
  async processShippedOrder(
    orderId: string,
    options: ProcessingOptions = {}
  ): Promise<LinkingResult> {
    // Set includeSold flag from options
    this.includeSold = options.includeSold || false;

    const result: LinkingResult = {
      orderId,
      status: 'pending',
      orderItemsProcessed: 0,
      autoLinked: 0,
      queuedForResolution: 0,
      errors: [],
    };

    try {
      // Get order
      const { data: order, error: orderError } = await this.supabase
        .from('platform_orders')
        .select(
          'id, user_id, platform, platform_order_id, order_date, status, internal_status, fulfilled_at, shipped_at, total'
        )
        .eq('id', orderId)
        .eq('user_id', this.userId)
        .eq('platform', 'amazon')
        .single();

      if (orderError || !order) {
        result.errors.push(`Order not found: ${orderId}`);
        return result;
      }

      // Get order items that haven't been Amazon-linked yet
      const { data: orderItems, error: itemsError } = await this.supabase
        .from('order_items')
        .select(
          'id, order_id, item_number, item_name, quantity, total_price, unit_price, inventory_item_id, amazon_linked_at'
        )
        .eq('order_id', orderId)
        .is('amazon_linked_at', null);

      if (itemsError) {
        result.errors.push(`Failed to fetch order items: ${itemsError.message}`);
        return result;
      }

      if (!orderItems || orderItems.length === 0) {
        result.status = 'complete';
        return result;
      }

      // Process each order item
      for (const orderItem of orderItems) {
        result.orderItemsProcessed++;

        // Determine mode: if inventory_item_id is set, use picklist mode
        const mode =
          options.mode === 'auto' || !options.mode
            ? orderItem.inventory_item_id
              ? 'picklist'
              : 'non_picklist'
            : options.mode;

        const matchResult = await this.matchOrderItemToInventory(orderItem, order, mode);

        if (
          matchResult.status === 'matched' &&
          matchResult.inventoryIds &&
          matchResult.inventoryIds.length > 0
        ) {
          // Auto-link successful
          const netSale = await this.calculateNetSale(
            order.platform_order_id,
            orderItem.item_number,
            orderItem.quantity
          );

          await this.markInventoryAsSold(matchResult.inventoryIds, orderItem, order, netSale);
          for (const invId of matchResult.inventoryIds) {
            archiveShopifyOnSold(this.supabase, this.userId, invId);
          }

          await this.linkOrderItemToInventory(
            orderItem.id,
            matchResult.inventoryIds[0],
            matchResult.method!
          );

          result.autoLinked++;
        } else {
          // Add to resolution queue
          await this.addToResolutionQueue(orderItem, order, matchResult);
          result.queuedForResolution++;
        }
      }

      // Update order linking status
      const allLinked = result.queuedForResolution === 0;
      const someLinked = result.autoLinked > 0;

      result.status = allLinked ? 'complete' : someLinked ? 'partial' : 'pending';

      await this.supabase
        .from('platform_orders')
        .update({
          inventory_link_status: result.status,
        })
        .eq('id', orderId);

      return result;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      return result;
    }
  }

  /**
   * Process historical Amazon orders that haven't been linked
   */
  async processHistoricalOrders(options: ProcessingOptions = {}): Promise<BulkLinkingResult> {
    this.includeSold = options.includeSold || false;

    const result: BulkLinkingResult = {
      ordersProcessed: 0,
      ordersComplete: 0,
      ordersPartial: 0,
      ordersPending: 0,
      totalAutoLinked: 0,
      totalQueuedForResolution: 0,
      errors: [],
    };

    // Get all shipped Amazon orders without inventory linking - with pagination
    let allOrders: Array<{ id: string; platform_order_id: string; order_date: string }> = [];

    try {
      allOrders = (await fetchAllRecords(this.supabase, 'platform_orders', {
        select: 'id, platform_order_id, order_date',
        eq: { user_id: this.userId, platform: 'amazon' },
        in: { status: ['Shipped', 'Delivered'] }, // Amazon shipped statuses
        isNull: ['inventory_link_status'],
        orderBy: { column: 'order_date', ascending: false },
      })) as unknown as Array<{ id: string; platform_order_id: string; order_date: string }>;
    } catch (error) {
      result.errors.push(
        `Failed to fetch orders: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    console.log(`[AmazonInventoryLinking] Processing ${allOrders.length} historical orders`);

    const totalOrders = allOrders.length;

    for (const order of allOrders) {
      const linkingResult = await this.processShippedOrder(order.id, options);
      result.ordersProcessed++;
      result.totalAutoLinked += linkingResult.autoLinked;
      result.totalQueuedForResolution += linkingResult.queuedForResolution;

      if (linkingResult.status === 'complete') {
        result.ordersComplete++;
      } else if (linkingResult.status === 'partial') {
        result.ordersPartial++;
      } else {
        result.ordersPending++;
      }

      if (options.onProgress) {
        options.onProgress(
          result.ordersProcessed,
          totalOrders,
          result.totalAutoLinked,
          result.totalQueuedForResolution
        );
      }

      if (linkingResult.errors.length > 0) {
        result.errors.push(
          ...linkingResult.errors.map((e) => `Order ${order.platform_order_id}: ${e}`)
        );
      }
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Matching Algorithm
  // --------------------------------------------------------------------------

  /**
   * Match an order item to inventory
   * Mode 1 (picklist): Verify existing link, calculate financials
   * Mode 2 (non-picklist): Find by ASIN, FIFO for multi-quantity
   */
  async matchOrderItemToInventory(
    orderItem: OrderItem,
    order: PlatformOrder,
    mode: 'picklist' | 'non_picklist'
  ): Promise<AmazonMatchResult> {
    const asin = orderItem.item_number;
    const quantity = orderItem.quantity;

    // Mode 1: Pick List - inventory already linked from fulfillment
    if (mode === 'picklist' && orderItem.inventory_item_id) {
      // Verify the linked inventory item is valid
      const { data: inventory } = await this.supabase
        .from('inventory_items')
        .select('id, amazon_asin, set_number, status, sold_order_id')
        .eq('id', orderItem.inventory_item_id)
        .eq('user_id', this.userId)
        .single();

      // Guard against the double-link bug: the fulfillment/picklist workflow can
      // point two orders at the SAME unit, or re-use a unit that already sold to a
      // different order. Only auto-accept the pre-link when the unit is still
      // claimable BY THIS order; otherwise fall through to ASIN matching, which
      // claims a fresh unit (or queues for resolution if none remain). This stops
      // one physical unit from being marked sold against two orders.
      if (inventory && (await this.isUnitClaimableBy(inventory, orderItem, order))) {
        // Check if ASIN matches (optional validation)
        if (inventory.amazon_asin && inventory.amazon_asin !== asin) {
          // ASIN mismatch - might be wrong item linked
          const candidates = await this.findByAsin(asin, 10);
          return {
            status: 'manual_required',
            reason: 'picklist_mismatch',
            candidates: this.rankCandidates(candidates, orderItem),
            quantityNeeded: quantity,
          };
        }

        // For multi-quantity with picklist, we need to find additional items
        if (quantity > 1) {
          const additionalItems = await this.findByAsin(asin, quantity - 1);
          const allInventoryIds = [
            orderItem.inventory_item_id,
            ...additionalItems.map((i) => i.id),
          ];

          if (allInventoryIds.length < quantity) {
            // Not enough inventory
            const candidates = await this.findByAsin(asin, 20);
            return {
              status: 'manual_required',
              reason: 'insufficient_inventory',
              candidates: this.rankCandidates(candidates, orderItem),
              quantityNeeded: quantity,
              quantityMatched: allInventoryIds.length,
            };
          }

          return {
            status: 'matched',
            method: 'auto_picklist',
            inventoryIds: allInventoryIds.slice(0, quantity),
            confidence: 1.0,
          };
        }

        // Single quantity - already linked
        return {
          status: 'matched',
          method: 'auto_picklist',
          inventoryIds: [orderItem.inventory_item_id],
          confidence: 1.0,
        };
      }
    }

    // Mode 2: Non-Pick List - find by ASIN
    if (!asin) {
      return {
        status: 'unmatched',
        reason: 'no_asin',
        candidates: [],
      };
    }

    // Find inventory by ASIN (FIFO sorted)
    const matches = await this.findByAsin(asin, quantity + 5); // Get a few extra for ranking

    if (matches.length === 0) {
      return {
        status: 'unmatched',
        reason: 'no_matches',
        candidates: [],
      };
    }

    // Check if we have enough for the quantity
    if (matches.length < quantity) {
      return {
        status: 'manual_required',
        reason: 'insufficient_inventory',
        candidates: this.rankCandidates(matches, orderItem),
        quantityNeeded: quantity,
        quantityMatched: matches.length,
      };
    }

    // Auto-link: take the N oldest items (FIFO)
    const selectedItems = matches.slice(0, quantity);

    return {
      status: 'matched',
      method: 'auto_asin',
      inventoryIds: selectedItems.map((i) => i.id),
      confidence: 1.0,
    };
  }

  /**
   * Is `unit` still claimable as the sold item for THIS order?
   *
   * Returns false when the unit is already consumed by a *different* order —
   * either it's SOLD against another order, or another order_item already links
   * to it. This is the guard that prevents the linker from marking one physical
   * unit sold against two orders (the historical double-link bug). A unit that is
   * SOLD against *this* same order stays claimable, so re-processing is idempotent.
   *
   * `sold_order_id` may hold either the Amazon order string or the internal
   * platform_orders UUID, so both forms are accepted.
   */
  private async isUnitClaimableBy(
    unit: { id: string; status: string; sold_order_id?: string | null },
    orderItem: OrderItem,
    order: PlatformOrder
  ): Promise<boolean> {
    if (unit.status === 'SOLD') {
      const soldTo = unit.sold_order_id ?? null;
      const thisOrder = soldTo === order.platform_order_id || soldTo === order.id;
      if (!thisOrder) return false; // sold to a different (or unknown) order
    }

    // Linked to another order's line item?
    const { data: otherLinks } = await this.supabase
      .from('order_items')
      .select('id')
      .eq('inventory_item_id', unit.id)
      .neq('order_id', orderItem.order_id)
      .limit(1);

    return !otherLinks || otherLinks.length === 0;
  }

  // --------------------------------------------------------------------------
  // Inventory Search Methods
  // --------------------------------------------------------------------------

  /**
   * Get inventory IDs that are already linked to any order
   */
  private async getLinkedInventoryIds(): Promise<Set<string>> {
    const { data: linkedItems } = await this.supabase
      .from('order_items')
      .select('inventory_item_id')
      .not('inventory_item_id', 'is', null);

    return new Set(
      (linkedItems || [])
        .map((item: { inventory_item_id: string | null }) => item.inventory_item_id)
        .filter((id: string | null): id is string => id !== null)
    );
  }

  /**
   * Find inventory items by ASIN
   * Returns items sorted by created_at (FIFO)
   * Filters: amazon_asin matches, listing_platform = 'amazon' (case-insensitive), valid status
   * Excludes items already linked to any order
   */
  private async findByAsin(asin: string, limit: number = 10): Promise<InventoryItem[]> {
    // Get IDs of inventory items already linked to orders
    const linkedIds = await this.getLinkedInventoryIds();

    const { data } = await this.supabase
      .from('inventory_items')
      .select(
        'id, amazon_asin, set_number, item_name, condition, storage_location, listing_value, listing_platform, cost, purchase_date, created_at, status, amazon_order_item_id'
      )
      .eq('user_id', this.userId)
      .eq('amazon_asin', asin)
      .ilike('listing_platform', '%amazon%') // Case-insensitive match for AMAZON/amazon
      .in('status', this.getValidStatuses())
      .order('created_at', { ascending: true }) // FIFO - oldest first
      .limit(limit * 2); // Fetch extra to account for filtering

    // Filter out items already linked to any order
    const filtered = (data || []).filter((item: InventoryItem) => !linkedIds.has(item.id));

    return filtered.slice(0, limit);
  }

  /**
   * Search inventory by set number (fallback for manual resolution)
   * Excludes items already linked to any order
   */
  private async findBySetNumber(setNumber: string): Promise<InventoryItem[]> {
    // Get IDs of inventory items already linked to orders
    const linkedIds = await this.getLinkedInventoryIds();

    const { data } = await this.supabase
      .from('inventory_items')
      .select(
        'id, amazon_asin, set_number, item_name, condition, storage_location, listing_value, listing_platform, cost, purchase_date, created_at, status, amazon_order_item_id'
      )
      .eq('user_id', this.userId)
      .eq('set_number', setNumber)
      .in('status', this.getValidStatuses())
      .order('created_at', { ascending: true })
      .limit(40); // Fetch extra to account for filtering

    // Filter out items already linked to any order
    return (data || []).filter((item: InventoryItem) => !linkedIds.has(item.id)).slice(0, 20);
  }

  /**
   * Search inventory by title keywords (for manual resolution)
   */
  async searchInventory(query: string): Promise<InventoryItem[]> {
    // Try set number first
    const setNumber = this.extractSetNumber(query);
    if (setNumber) {
      const setMatches = await this.findBySetNumber(setNumber);
      if (setMatches.length > 0) {
        return setMatches;
      }
    }

    // Fall back to title search
    const { data } = await this.supabase
      .from('inventory_items')
      .select(
        'id, amazon_asin, set_number, item_name, condition, storage_location, listing_value, listing_platform, cost, purchase_date, created_at, status, amazon_order_item_id'
      )
      .eq('user_id', this.userId)
      .in('status', this.getValidStatuses())
      .ilike('item_name', `%${query}%`)
      .order('created_at', { ascending: true })
      .limit(20);

    return (data || []).filter(
      (item: InventoryItem) => item.status !== 'SOLD' || !item.amazon_order_item_id
    );
  }

  // --------------------------------------------------------------------------
  // Candidate Ranking
  // --------------------------------------------------------------------------

  /**
   * Rank candidates by relevance
   */
  private rankCandidates(candidates: InventoryItem[], orderItem: OrderItem): RankedCandidate[] {
    return candidates
      .map((item) => {
        const { score, reasons } = this.calculateScore(item, orderItem);
        return {
          ...item,
          score,
          reasons,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate match score for an inventory item
   */
  private calculateScore(
    item: InventoryItem,
    orderItem: OrderItem
  ): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // ASIN exact match (40 points)
    if (item.amazon_asin && orderItem.item_number && item.amazon_asin === orderItem.item_number) {
      score += 40;
      reasons.push('Exact ASIN match');
    }

    // Listed on Amazon (20 points) - case-insensitive
    if (item.listing_platform?.toLowerCase() === 'amazon') {
      score += 20;
      reasons.push('Listed on Amazon');
    }

    // Status: LISTED preferred over BACKLOG (15 points)
    if (item.status === 'LISTED') {
      score += 15;
      reasons.push('Status: LISTED');
    } else if (item.status === 'BACKLOG') {
      score += 10;
      reasons.push('Status: BACKLOG');
    }

    // Has storage location (10 points)
    if (item.storage_location) {
      score += 10;
      reasons.push(`Location: ${item.storage_location}`);
    }

    // Price proximity (15 points max)
    if (item.listing_value && orderItem.total_price) {
      const priceDiff = Math.abs(item.listing_value - orderItem.total_price);
      const priceRatio = priceDiff / orderItem.total_price;
      if (priceRatio < 0.1) {
        score += 15;
        reasons.push('Price within 10%');
      } else if (priceRatio < 0.25) {
        score += 10;
        reasons.push('Price within 25%');
      } else if (priceRatio < 0.5) {
        score += 5;
        reasons.push('Price within 50%');
      }
    }

    // FIFO bonus - older items get more points (based on created_at)
    if (item.created_at) {
      const createdDate = new Date(item.created_at);
      const daysSinceCreated = Math.floor(
        (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const fifoScore = Math.min(10, Math.floor(daysSinceCreated / 18));
      if (fifoScore > 0) {
        score += fifoScore;
        reasons.push(`FIFO: ${daysSinceCreated} days old`);
      }
    }

    return { score, reasons };
  }

  // --------------------------------------------------------------------------
  // Text Extraction Helpers
  // --------------------------------------------------------------------------

  /**
   * Extract LEGO set number from text
   */
  private extractSetNumber(text: string): string | null {
    const matches = text.match(/\b(\d{4,6})\b/g);
    if (!matches) return null;

    const validSetNumbers = matches.filter((num) => {
      const n = parseInt(num, 10);
      return n >= 100 && (n < 1990 || n > 2030) && n < 100000;
    });

    return validSetNumbers[0] || null;
  }

  // --------------------------------------------------------------------------
  // Net Sale Calculation
  // --------------------------------------------------------------------------

  /**
   * Calculate net sale from amazon_transactions
   */
  async calculateNetSale(
    amazonOrderId: string,
    asin: string,
    quantity: number
  ): Promise<AmazonNetSaleCalculation> {
    // Get transaction for this order + ASIN
    const { data: transaction } = await this.supabase
      .from('amazon_transactions')
      .select(
        'gross_sales_amount, total_fees, total_amount, referral_fee, fba_fulfillment_fee, fba_per_unit_fee, fba_weight_fee'
      )
      .eq('user_id', this.userId)
      .eq('amazon_order_id', amazonOrderId)
      .eq('asin', asin)
      .eq('transaction_type', 'Shipment')
      .single();

    if (!transaction) {
      // Try without ASIN filter (some transactions might not have ASIN)
      const { data: orderTransaction } = await this.supabase
        .from('amazon_transactions')
        .select(
          'gross_sales_amount, total_fees, total_amount, referral_fee, fba_fulfillment_fee, fba_per_unit_fee, fba_weight_fee'
        )
        .eq('user_id', this.userId)
        .eq('amazon_order_id', amazonOrderId)
        .eq('transaction_type', 'Shipment')
        .single();

      if (!orderTransaction) {
        return {
          grossAmount: 0,
          feesAmount: null,
          netAmount: null,
          referralFee: null,
          fbaFee: null,
          status: 'pending_transaction',
        };
      }

      // Use order-level transaction (divide by quantity if multi-item)
      const perItemGross = (orderTransaction.gross_sales_amount || 0) / quantity;
      const perItemFees = (orderTransaction.total_fees || 0) / quantity;
      const perItemNet = (orderTransaction.total_amount || 0) / quantity;

      return {
        grossAmount: perItemGross,
        feesAmount: perItemFees,
        netAmount: perItemNet,
        referralFee: orderTransaction.referral_fee
          ? orderTransaction.referral_fee / quantity
          : null,
        fbaFee: this.calculateFbaFee(orderTransaction) / quantity,
        status: 'calculated',
      };
    }

    // Per-item transaction found
    return {
      grossAmount: transaction.gross_sales_amount || 0,
      feesAmount: transaction.total_fees || 0,
      netAmount: transaction.total_amount || 0,
      referralFee: transaction.referral_fee,
      fbaFee: this.calculateFbaFee(transaction),
      status: 'calculated',
    };
  }

  /**
   * Calculate total FBA fee from component fees
   */
  private calculateFbaFee(transaction: {
    fba_fulfillment_fee?: number | null;
    fba_per_unit_fee?: number | null;
    fba_weight_fee?: number | null;
  }): number {
    return (
      (transaction.fba_fulfillment_fee || 0) +
      (transaction.fba_per_unit_fee || 0) +
      (transaction.fba_weight_fee || 0)
    );
  }

  // --------------------------------------------------------------------------
  // Database Updates
  // --------------------------------------------------------------------------

  /**
   * Mark inventory items as sold with Amazon sale details
   * @throws Error if any update fails
   */
  private async markInventoryAsSold(
    inventoryIds: string[],
    orderItem: OrderItem,
    order: PlatformOrder,
    netSale: AmazonNetSaleCalculation
  ): Promise<void> {
    const perItemAmount = (orderItem.total_price || 0) / inventoryIds.length;
    const perItemGross = netSale.grossAmount / inventoryIds.length;
    const perItemFees = netSale.feesAmount ? netSale.feesAmount / inventoryIds.length : null;
    const perItemNet = netSale.netAmount ? netSale.netAmount / inventoryIds.length : null;

    for (const inventoryId of inventoryIds) {
      const { error, count } = await this.supabase
        .from('inventory_items')
        .update({
          status: 'SOLD',
          sold_date: order.order_date,
          sold_at: new Date().toISOString(),
          sold_price: perItemAmount,
          sold_platform: 'amazon',
          sold_order_id: order.platform_order_id,
          sold_gross_amount: perItemGross,
          sold_fees_amount: perItemFees,
          sold_net_amount: perItemNet,
          amazon_order_item_id: orderItem.id,
          storage_location: null, // Clear storage location when sold
        })
        .eq('id', inventoryId)
        .eq('user_id', this.userId);

      if (error) {
        throw new Error(`Failed to mark inventory ${inventoryId} as sold: ${error.message}`);
      }
      if (count === 0) {
        console.warn(
          `[AmazonInventoryLinking] No rows updated for inventory ${inventoryId} - may not exist or wrong user`
        );
      }
    }
  }

  /**
   * Link order item to inventory
   * @throws Error if update fails or no rows updated
   */
  private async linkOrderItemToInventory(
    orderItemId: string,
    inventoryId: string,
    method: 'auto_picklist' | 'auto_asin' | 'manual'
  ): Promise<void> {
    const { error, count } = await this.supabase
      .from('order_items')
      .update({
        inventory_item_id: inventoryId,
        amazon_linked_at: new Date().toISOString(),
        amazon_link_method: method,
      })
      .eq('id', orderItemId);

    if (error) {
      throw new Error(
        `Failed to link order item ${orderItemId} to inventory ${inventoryId}: ${error.message}`
      );
    }
    if (count === 0) {
      throw new Error(
        `No rows updated when linking order item ${orderItemId} - item may not exist`
      );
    }
  }

  /**
   * Add to resolution queue
   */
  private async addToResolutionQueue(
    orderItem: OrderItem,
    order: PlatformOrder,
    matchResult: AmazonMatchResult
  ): Promise<void> {
    const candidatesJson = matchResult.candidates?.map((c) => ({
      id: c.id,
      amazon_asin: c.amazon_asin,
      set_number: c.set_number,
      item_name: c.item_name,
      condition: c.condition,
      storage_location: c.storage_location,
      listing_value: c.listing_value,
      cost: c.cost,
      purchase_date: c.purchase_date,
      created_at: c.created_at,
      status: c.status,
      score: c.score,
      reasons: c.reasons,
    }));

    await this.supabase.from('amazon_inventory_resolution_queue').upsert(
      {
        user_id: this.userId,
        order_item_id: orderItem.id,
        platform_order_id: order.id,
        asin: orderItem.item_number,
        item_name: orderItem.item_name || 'Unknown Item',
        quantity: orderItem.quantity,
        total_amount: orderItem.total_price || 0,
        order_date: order.order_date,
        amazon_order_id: order.platform_order_id,
        status: 'pending',
        resolution_reason: matchResult.reason || 'no_matches',
        match_candidates: candidatesJson || [],
        quantity_needed: matchResult.quantityNeeded || orderItem.quantity,
      },
      {
        onConflict: 'order_item_id',
      }
    );
  }

  // --------------------------------------------------------------------------
  // Manual Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve a queue item by selecting inventory item(s)
   */
  async resolveQueueItem(
    queueItemId: string,
    inventoryItemIds: string[]
  ): Promise<{ success: boolean; error?: string }> {
    // Get the queue item with related data
    const { data: queueItem, error: queueError } = await this.supabase
      .from('amazon_inventory_resolution_queue')
      .select('*, order_items!inner(*), platform_orders!inner(*)')
      .eq('id', queueItemId)
      .eq('user_id', this.userId)
      .single();

    if (queueError || !queueItem) {
      return { success: false, error: 'Queue item not found' };
    }

    if (queueItem.status !== 'pending') {
      return { success: false, error: 'Queue item already resolved' };
    }

    // Validate quantity
    if (inventoryItemIds.length !== queueItem.quantity_needed) {
      return {
        success: false,
        error: `Expected ${queueItem.quantity_needed} inventory items, got ${inventoryItemIds.length}`,
      };
    }

    // Check if any inventory items are already linked to another order
    const { data: alreadyLinked } = await this.supabase
      .from('order_items')
      .select('id, inventory_item_id, platform_orders!inner(platform_order_id)')
      .in('inventory_item_id', inventoryItemIds)
      .not('inventory_item_id', 'is', null);

    if (alreadyLinked && alreadyLinked.length > 0) {
      const linkedOrders = alreadyLinked.map(
        (item: { platform_orders: { platform_order_id: string } }) =>
          item.platform_orders.platform_order_id
      );
      return {
        success: false,
        error: `Inventory item(s) already linked to order(s): ${linkedOrders.join(', ')}`,
      };
    }

    const orderItem = queueItem.order_items as unknown as OrderItem;
    const order = queueItem.platform_orders as unknown as PlatformOrder;

    // Calculate financials
    const netSale = await this.calculateNetSale(
      order.platform_order_id,
      orderItem.item_number,
      orderItem.quantity
    );

    // Mark inventory as sold
    await this.markInventoryAsSold(inventoryItemIds, orderItem, order, netSale);
    for (const invId of inventoryItemIds) {
      archiveShopifyOnSold(this.supabase, this.userId, invId);
    }

    // Link order item to first inventory
    await this.linkOrderItemToInventory(orderItem.id, inventoryItemIds[0], 'manual');

    // Update queue item as resolved
    await this.supabase
      .from('amazon_inventory_resolution_queue')
      .update({
        status: 'resolved',
        resolved_inventory_item_ids: inventoryItemIds,
        resolved_at: new Date().toISOString(),
        resolved_by: this.userId,
      })
      .eq('id', queueItemId);

    // Update order linking status
    await this.updateOrderLinkStatus(order.id);

    return { success: true };
  }

  /**
   * Skip a queue item
   */
  async skipQueueItem(
    queueItemId: string,
    reason: 'skipped' | 'no_inventory'
  ): Promise<{ success: boolean; error?: string }> {
    // Grab the underlying order item before updating, so a 'no_inventory'
    // decision can be stamped durably on the order item itself.
    const { data: queueRow } = await this.supabase
      .from('amazon_inventory_resolution_queue')
      .select('order_item_id')
      .eq('id', queueItemId)
      .eq('user_id', this.userId)
      .single();

    const { error } = await this.supabase
      .from('amazon_inventory_resolution_queue')
      .update({
        status: reason,
        resolved_at: new Date().toISOString(),
        resolved_by: this.userId,
      })
      .eq('id', queueItemId)
      .eq('user_id', this.userId)
      .eq('status', 'pending');

    if (error) {
      return { success: false, error: error.message };
    }

    // 'no_inventory' is a conscious "won't link" decision. Stamp it on the order
    // item so it survives queue-row cleanup and is excluded from unlinked counts
    // regardless of whether the queue row still exists.
    if (reason === 'no_inventory' && queueRow?.order_item_id) {
      await this.supabase
        .from('order_items')
        .update({
          link_ignored: true,
          link_ignored_reason: 'no_inventory',
          link_ignored_at: new Date().toISOString(),
        })
        .eq('id', queueRow.order_item_id);
    }

    return { success: true };
  }

  /**
   * Update order linking status based on items
   */
  private async updateOrderLinkStatus(orderId: string): Promise<void> {
    // Get all order items
    const { data: orderItems } = await this.supabase
      .from('order_items')
      .select('id, amazon_linked_at')
      .eq('order_id', orderId);

    // Get pending queue items
    const { data: pendingQueue } = await this.supabase
      .from('amazon_inventory_resolution_queue')
      .select('id')
      .eq('platform_order_id', orderId)
      .eq('status', 'pending');

    const totalItems = orderItems?.length || 0;
    const linkedItems =
      orderItems?.filter((oi: { amazon_linked_at: string | null }) => oi.amazon_linked_at !== null)
        .length || 0;
    const pendingItems = pendingQueue?.length || 0;

    let status: 'pending' | 'partial' | 'complete' | 'skipped';

    if (pendingItems === 0 && linkedItems === totalItems) {
      status = 'complete';
    } else if (linkedItems > 0) {
      status = 'partial';
    } else {
      status = 'pending';
    }

    await this.supabase
      .from('platform_orders')
      .update({
        inventory_link_status: status,
      })
      .eq('id', orderId);
  }

  // --------------------------------------------------------------------------
  // Statistics
  // --------------------------------------------------------------------------

  /**
   * Get linking statistics for Amazon orders
   */
  async getStats(): Promise<{
    totalShippedOrders: number;
    linkedOrders: number;
    partialOrders: number;
    pendingOrders: number;
    pendingQueueItems: number;
  }> {
    const { data: orders } = await this.supabase
      .from('platform_orders')
      .select('inventory_link_status')
      .eq('user_id', this.userId)
      .eq('platform', 'amazon')
      .in('status', ['Shipped', 'Delivered']);

    const { count: pendingQueueItems } = await this.supabase
      .from('amazon_inventory_resolution_queue')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', this.userId)
      .eq('status', 'pending');

    type OrderWithLinkStatus = { inventory_link_status: string | null };
    const stats = {
      totalShippedOrders: orders?.length || 0,
      linkedOrders:
        orders?.filter((o: OrderWithLinkStatus) => o.inventory_link_status === 'complete').length ||
        0,
      partialOrders:
        orders?.filter((o: OrderWithLinkStatus) => o.inventory_link_status === 'partial').length ||
        0,
      pendingOrders:
        orders?.filter(
          (o: OrderWithLinkStatus) =>
            !o.inventory_link_status || o.inventory_link_status === 'pending'
        ).length || 0,
      pendingQueueItems: pendingQueueItems || 0,
    };

    return stats;
  }

  // --------------------------------------------------------------------------
  // Fee Backfill
  // --------------------------------------------------------------------------

  /**
   * Backfill fee data for inventory items that are linked to Amazon orders
   * but are missing transaction fee data (sold_fees_amount is null)
   */
  async backfillFeeData(): Promise<{
    processed: number;
    updated: number;
    stillPending: number;
    errors: string[];
  }> {
    const result = {
      processed: 0,
      updated: 0,
      stillPending: 0,
      errors: [] as string[],
    };

    // Find inventory items sold on Amazon with missing fee data
    const { data: itemsNeedingFees, error: fetchError } = await this.supabase
      .from('inventory_items')
      .select('id, sold_order_id, amazon_asin, sold_price')
      .eq('user_id', this.userId)
      .eq('sold_platform', 'amazon')
      .not('sold_order_id', 'is', null)
      .is('sold_fees_amount', null);

    if (fetchError) {
      result.errors.push(`Failed to fetch items: ${fetchError.message}`);
      return result;
    }

    if (!itemsNeedingFees || itemsNeedingFees.length === 0) {
      return result;
    }

    console.log(`[AmazonFeeBackfill] Found ${itemsNeedingFees.length} items needing fee data`);

    for (const item of itemsNeedingFees) {
      result.processed++;

      try {
        // Look up transaction by order ID and optionally ASIN
        let transaction = null;

        // First try with ASIN if available
        if (item.amazon_asin) {
          const { data } = await this.supabase
            .from('amazon_transactions')
            .select(
              'gross_sales_amount, total_fees, total_amount, referral_fee, fba_fulfillment_fee, fba_per_unit_fee, fba_weight_fee'
            )
            .eq('user_id', this.userId)
            .eq('amazon_order_id', item.sold_order_id)
            .eq('asin', item.amazon_asin)
            .eq('transaction_type', 'Shipment')
            .single();
          transaction = data;
        }

        // Fall back to order-level transaction without ASIN
        if (!transaction) {
          const { data } = await this.supabase
            .from('amazon_transactions')
            .select(
              'gross_sales_amount, total_fees, total_amount, referral_fee, fba_fulfillment_fee, fba_per_unit_fee, fba_weight_fee'
            )
            .eq('user_id', this.userId)
            .eq('amazon_order_id', item.sold_order_id)
            .eq('transaction_type', 'Shipment')
            .single();
          transaction = data;
        }

        if (!transaction) {
          // Transaction not yet available
          result.stillPending++;
          continue;
        }

        // Update inventory item with fee data
        // Note: FBA fee breakdown (fba_fulfillment_fee, fba_per_unit_fee, fba_weight_fee) is available
        // in transaction data if detailed breakdown is needed in the future
        const { error: updateError } = await this.supabase
          .from('inventory_items')
          .update({
            sold_gross_amount: transaction.gross_sales_amount || item.sold_price,
            sold_fees_amount: transaction.total_fees,
            sold_net_amount: transaction.total_amount,
          })
          .eq('id', item.id)
          .eq('user_id', this.userId);

        if (updateError) {
          result.errors.push(`Failed to update item ${item.id}: ${updateError.message}`);
        } else {
          result.updated++;
          console.log(
            `[AmazonFeeBackfill] Updated item ${item.id} with fees: ${transaction.total_fees}`
          );
        }
      } catch (err) {
        result.errors.push(
          `Error processing item ${item.id}: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }

    console.log(
      `[AmazonFeeBackfill] Complete: ${result.updated} updated, ${result.stillPending} still pending`
    );
    return result;
  }

  // --------------------------------------------------------------------------
  // Auto-Complete Old Orders
  // --------------------------------------------------------------------------

  /**
   * Auto-complete old Amazon orders that are:
   * 1. Linked to inventory (inventory_link_status = 'complete')
   * 2. Status is 'Shipped' (not yet marked completed)
   * 3. Order is older than the specified number of days
   *
   * This replicates the ConfirmOrdersDialog behavior for old orders.
   */
  async autoCompleteOldOrders(daysOld: number = 14): Promise<{
    processed: number;
    completed: number;
    errors: string[];
  }> {
    const result = {
      processed: 0,
      completed: 0,
      errors: [] as string[],
    };

    // Calculate the cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    // Find Amazon orders that are:
    // - Shipped status (raw Amazon status)
    // - Linked to inventory (inventory_link_status = 'complete')
    // - Not already marked as Completed internally
    // - Older than cutoff date
    const { data: orders, error: fetchError } = await this.supabase
      .from('platform_orders')
      .select('id, platform_order_id, order_date, status, internal_status, inventory_link_status')
      .eq('user_id', this.userId)
      .eq('platform', 'amazon')
      .eq('status', 'Shipped')
      .eq('inventory_link_status', 'complete')
      .or('internal_status.is.null,internal_status.neq.Completed')
      .lt('order_date', cutoffDate.toISOString());

    if (fetchError) {
      result.errors.push(`Failed to fetch orders: ${fetchError.message}`);
      return result;
    }

    if (!orders || orders.length === 0) {
      console.log('[AutoCompleteOldOrders] No orders found to auto-complete');
      return result;
    }

    console.log(
      `[AutoCompleteOldOrders] Found ${orders.length} orders to auto-complete (>${daysOld} days old)`
    );

    const now = new Date().toISOString();

    for (const order of orders) {
      result.processed++;

      try {
        // Update order to Completed (same as ConfirmOrdersDialog)
        const { error: updateError } = await this.supabase
          .from('platform_orders')
          .update({
            fulfilled_at: now,
            internal_status: 'Completed',
          })
          .eq('id', order.id)
          .eq('user_id', this.userId);

        if (updateError) {
          result.errors.push(
            `Failed to complete order ${order.platform_order_id}: ${updateError.message}`
          );
        } else {
          result.completed++;
          console.log(
            `[AutoCompleteOldOrders] Completed order ${order.platform_order_id} (${order.order_date})`
          );
        }
      } catch (err) {
        result.errors.push(
          `Error processing order ${order.platform_order_id}: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }

    console.log(`[AutoCompleteOldOrders] Complete: ${result.completed} orders marked as Completed`);
    return result;
  }

  // --------------------------------------------------------------------------
  // Phantom-stock reconciliation
  // --------------------------------------------------------------------------

  /**
   * Detect "phantom stock" — inventory units still shown as LISTED/BACKLOG that
   * actually sold on Amazon (the order shipped but its sale was never linked to a
   * unit, e.g. the double-link bug). The Amazon analogue of the Shopify
   * archive-drift reconciler.
   *
   * Detection (corrected for the two blind spots that caused false orphans):
   *  - An order is "covered" when a SOLD unit references it by EITHER the Amazon
   *    order string OR the internal platform_orders UUID (both forms occur).
   *  - Coverage is quantity-aware (a qty-2 order needs 2 linked units).
   *  - A current LISTED/BACKLOG unit is only a phantom if it was listed ON OR
   *    BEFORE the uncovered sale (chronology guard) — otherwise it's real stock.
   *
   * Alert-only: surfaces candidates to Discord for review rather than
   * auto-marking sold, because marking sold is a financial mutation and the
   * matching, while strong, can have edge cases (multi-qty, price). Returns the
   * candidate list so callers/validators can act.
   */
  async reconcilePhantomStock(opts?: { alert?: boolean }): Promise<PhantomReconcileResult> {
    const shouldAlert = opts?.alert ?? true;

    // 0. Self-covering phantoms: units that are LISTED/BACKLOG yet still carry
    //    their OWN amazon sold_order_id (sold then wrongly re-listed). Invisible
    //    to the per-ASIN coverage math (a unit "covers" its own order), so detect
    //    them directly. Exclude returns (returned_from_item_id) — those legitimately
    //    re-list — and cancelled orders.
    const selfCovering: PhantomInStockUnit[] = [];
    {
      const candidates: Array<PhantomInStockUnit & { sold_order_id: string }> = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await this.supabase
          .from('inventory_items')
          .select(
            'id, sku, set_number, item_name, amazon_asin, listing_date, listing_value, sold_order_id'
          )
          .eq('user_id', this.userId)
          .in('status', ['LISTED', 'BACKLOG'])
          .eq('sold_platform', 'amazon')
          .not('sold_order_id', 'is', null)
          .is('returned_from_item_id', null)
          .range(from, from + 999);
        if (!data || data.length === 0) break;
        candidates.push(
          ...(data as unknown as Array<PhantomInStockUnit & { sold_order_id: string }>)
        );
        if (data.length < 1000) break;
      }
      if (candidates.length > 0) {
        // Drop any whose order was Cancelled (sold_order_id may be the Amazon
        // string or the platform_orders UUID — check both).
        const ids = [...new Set(candidates.map((c) => c.sold_order_id))];
        const uuids = ids.filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(s));
        const cancelled = new Set<string>();
        for (let i = 0; i < ids.length; i += 100) {
          const { data: byStr } = await this.supabase
            .from('platform_orders')
            .select('platform_order_id, internal_status')
            .in('platform_order_id', ids.slice(i, i + 100));
          for (const o of (byStr ?? []) as Array<{ platform_order_id: string; internal_status: string | null }>) {
            if ((o.internal_status ?? '') === 'Cancelled') cancelled.add(o.platform_order_id);
          }
        }
        for (let i = 0; i < uuids.length; i += 100) {
          const { data: byId } = await this.supabase
            .from('platform_orders')
            .select('id, internal_status')
            .in('id', uuids.slice(i, i + 100));
          for (const o of (byId ?? []) as Array<{ id: string; internal_status: string | null }>) {
            if ((o.internal_status ?? '') === 'Cancelled') cancelled.add(o.id);
          }
        }
        for (const c of candidates) {
          if (cancelled.has(c.sold_order_id)) continue;
          selfCovering.push({
            id: c.id,
            sku: c.sku,
            set_number: c.set_number,
            item_name: c.item_name,
            amazon_asin: c.amazon_asin,
            listing_date: c.listing_date,
            listing_value: c.listing_value,
          });
        }
      }
    }

    // 1. In-stock Amazon units (LISTED/BACKLOG) that have an ASIN + listing date.
    const inStock: PhantomInStockUnit[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await this.supabase
        .from('inventory_items')
        .select('id, sku, set_number, item_name, amazon_asin, listing_date, listing_value')
        .eq('user_id', this.userId)
        .in('status', ['LISTED', 'BACKLOG'])
        .not('amazon_asin', 'is', null)
        .not('listing_date', 'is', null)
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      inStock.push(...(data as unknown as PhantomInStockUnit[]));
      if (data.length < 1000) break;
    }
    if (inStock.length === 0) {
      const alerted =
        shouldAlert && selfCovering.length > 0
          ? await this.sendPhantomAlert([], selfCovering)
          : false;
      return { checkedOrders: 0, uncoveredUnits: 0, phantoms: [], selfCovering, alerted };
    }
    const inStockByAsin = new Map<string, PhantomInStockUnit[]>();
    for (const u of inStock) {
      if (!u.amazon_asin) continue;
      const k = u.amazon_asin.trim();
      const arr = inStockByAsin.get(k);
      if (arr) arr.push(u);
      else inStockByAsin.set(k, [u]);
    }
    const asinsWithStock = [...inStockByAsin.keys()];

    // 2. Coverage frequency: how many SOLD Amazon units reference each order id
    //    (keyed by both the Amazon string and the platform_orders UUID forms).
    const soldFreq = new Map<string, number>();
    for (let from = 0; ; from += 1000) {
      const { data } = await this.supabase
        .from('inventory_items')
        .select('sold_order_id')
        .eq('user_id', this.userId)
        .eq('sold_platform', 'amazon')
        .not('sold_order_id', 'is', null)
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      for (const r of data as Array<{ sold_order_id: string }>) {
        soldFreq.set(r.sold_order_id, (soldFreq.get(r.sold_order_id) ?? 0) + 1);
      }
      if (data.length < 1000) break;
    }

    // 3. Shipped, non-cancelled Amazon order lines for the in-stock ASINs.
    //    Aggregate per order: total shipped qty + estimated per-unit value.
    interface OrderAgg {
      poId: string;
      platformOrderId: string;
      orderDate: string;
      asin: string;
      qty: number;
      total: number;
    }
    const orderAgg = new Map<string, OrderAgg>();
    for (let i = 0; i < asinsWithStock.length; i += 100) {
      const chunk = asinsWithStock.slice(i, i + 100);
      for (let from = 0; ; from += 1000) {
        const { data } = await this.supabase
          .from('order_items')
          .select(
            'quantity, item_number, platform_orders!inner(id, platform_order_id, order_date, total, platform, internal_status, user_id)'
          )
          .in('item_number', chunk)
          .gt('quantity', 0)
          .eq('platform_orders.platform', 'amazon')
          .eq('platform_orders.user_id', this.userId)
          .range(from, from + 999);
        if (!data || data.length === 0) break;
        for (const row of data as unknown as Array<{
          quantity: number;
          item_number: string | null;
          platform_orders: {
            id: string;
            platform_order_id: string;
            order_date: string | null;
            total: number | null;
            internal_status: string | null;
          } | null;
        }>) {
          const po = row.platform_orders;
          if (!po || !po.order_date) continue;
          if ((po.internal_status ?? '') === 'Cancelled') continue;
          const existing = orderAgg.get(po.id);
          if (existing) {
            existing.qty += row.quantity;
          } else {
            orderAgg.set(po.id, {
              poId: po.id,
              platformOrderId: po.platform_order_id,
              orderDate: po.order_date,
              asin: (row.item_number ?? '').trim(),
              qty: row.quantity,
              total: Number(po.total) || 0,
            });
          }
        }
        if (data.length < 1000) break;
      }
    }

    // 4. Uncovered orders: linked (by either id form) < shipped qty.
    const uncoveredByAsin = new Map<string, PhantomUncoveredOrder[]>();
    let uncoveredUnits = 0;
    for (const agg of orderAgg.values()) {
      const linked =
        (soldFreq.get(agg.platformOrderId) ?? 0) + (soldFreq.get(agg.poId) ?? 0);
      const short = agg.qty - linked;
      if (short <= 0) continue;
      const perUnit = agg.qty > 0 && agg.total > 0 ? agg.total / agg.qty : null;
      const list = uncoveredByAsin.get(agg.asin) ?? [];
      list.push({
        platformOrderId: agg.platformOrderId,
        orderDate: agg.orderDate,
        short,
        perUnit,
      });
      uncoveredByAsin.set(agg.asin, list);
      uncoveredUnits += short;
    }

    // 5. FIFO-assign uncovered units to chronologically-plausible in-stock units.
    const phantoms = assignPhantomCandidates(inStockByAsin, uncoveredByAsin);

    // 6. Alert on candidates (no auto-mutation).
    const alerted =
      shouldAlert && (phantoms.length > 0 || selfCovering.length > 0)
        ? await this.sendPhantomAlert(phantoms, selfCovering)
        : false;

    console.log(
      `[PhantomReconcile] checked ${orderAgg.size} orders, ${uncoveredUnits} uncovered, ${phantoms.length} phantom candidate(s), ${selfCovering.length} self-covering`
    );

    return { checkedOrders: orderAgg.size, uncoveredUnits, phantoms, selfCovering, alerted };
  }

  /** Build + post the phantom-stock Discord summary. Returns true (alerted). */
  private async sendPhantomAlert(
    phantoms: PhantomCandidate[],
    selfCovering: PhantomInStockUnit[]
  ): Promise<boolean> {
    const sections: string[] = [];
    if (selfCovering.length > 0) {
      const ex = selfCovering
        .slice(0, 6)
        .map((u) => `• ${u.set_number ?? '?'} ${u.item_name ?? ''} (${u.sku ?? 'no-sku'})`)
        .join('\n');
      sections.push(
        `**${selfCovering.length} already-sold unit(s) wrongly re-listed** — they still carry their own sold_order_id; re-mark SOLD:\n${ex}` +
          (selfCovering.length > 6 ? `\n…and ${selfCovering.length - 6} more.` : '')
      );
    }
    if (phantoms.length > 0) {
      const ex = phantoms
        .slice(0, 6)
        .map(
          (p) =>
            `• ${p.unit.set_number ?? '?'} ${p.unit.item_name ?? ''} (${p.unit.sku ?? 'no-sku'}) — sold ${p.order.orderDate.slice(0, 10)} via ${p.order.platformOrderId}`
        )
        .join('\n');
      sections.push(
        `**${phantoms.length} unit(s) shown as available but appear sold** (order shipped, sale never linked):\n${ex}` +
          (phantoms.length > 6 ? `\n…and ${phantoms.length - 6} more.` : '')
      );
    }
    await discordService
      .sendSyncStatus({
        title: '⚠️ Amazon phantom stock detected',
        message:
          sections.join('\n\n') +
          `\n\nReview & mark sold — these won't sell again and may oversell on cross-listed channels.`,
        success: false,
      })
      .catch(() => {});
    return true;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createAmazonInventoryLinkingService(): Promise<AmazonInventoryLinkingService | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  return new AmazonInventoryLinkingService(supabase, user.id);
}

/**
 * Cost Allocation Service
 *
 * Distributes purchase costs proportionally across linked inventory items
 * and BrickLink uploads based on their listing value / selling price.
 *
 * Formula: item.cost = (item.listing_value / total_listing_value) * purchase.cost
 *
 * Edge cases:
 * - Purchase cost = 0 -> all eligible items get cost = 0
 * - No linked items -> skip purchase
 * - All items have NULL/0 listing value -> skip purchase
 * - Single item -> gets 100% of cost
 * - Rounding remainder -> applied to highest-value item
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CostChange {
  id: string;
  type: 'inventory_item' | 'bricklink_upload';
  name: string;
  listingValue: number;
  oldCost: number;
  newCost: number;
  change: number;
}

export interface PurchaseAllocationResult {
  purchaseId: string;
  purchaseDescription: string | null;
  purchaseSource: string | null;
  purchaseCost: number;
  totalListingValue: number;
  itemCount: number;
  changes: CostChange[];
  skipped: boolean;
  skipReason?: string;
}

export interface CostAllocationSummary {
  totalPurchases: number;
  purchasesProcessed: number;
  purchasesSkipped: number;
  purchasesWithChanges: number;
  totalChanges: number;
  totalCostAllocated: number;
  durationMs: number;
  results: PurchaseAllocationResult[];
}

interface PurchaseRow {
  id: string;
  cost: number | null;
  description: string | null;
  source: string | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CostAllocationService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Allocate costs for ALL purchases. Paginates to respect 1000-row limit.
   */
  async allocateAll(userId: string): Promise<CostAllocationSummary> {
    const startTime = Date.now();

    const purchases = await this.fetchAllPurchases(userId);

    const results: PurchaseAllocationResult[] = [];
    let purchasesProcessed = 0;
    let purchasesSkipped = 0;
    let purchasesWithChanges = 0;
    let totalChanges = 0;
    let totalCostAllocated = 0;

    for (const purchase of purchases) {
      const result = await this.allocatePurchase(purchase);

      if (result.skipped) {
        purchasesSkipped++;
      } else {
        purchasesProcessed++;
        totalCostAllocated += purchase.cost ?? 0;
        if (result.changes.length > 0) {
          purchasesWithChanges++;
          totalChanges += result.changes.length;
          results.push(result);
        }
      }
    }

    return {
      totalPurchases: purchases.length,
      purchasesProcessed,
      purchasesSkipped,
      purchasesWithChanges,
      totalChanges,
      totalCostAllocated,
      durationMs: Date.now() - startTime,
      results,
    };
  }

  /**
   * Allocate cost for a single purchase across its linked items.
   */
  async allocatePurchase(purchase: PurchaseRow): Promise<PurchaseAllocationResult> {
    const base: Omit<PurchaseAllocationResult, 'skipped' | 'skipReason' | 'changes'> = {
      purchaseId: purchase.id,
      purchaseDescription: purchase.description,
      purchaseSource: purchase.source,
      purchaseCost: purchase.cost ?? 0,
      totalListingValue: 0,
      itemCount: 0,
    };

    const purchaseCost = purchase.cost ?? 0;

    // Fetch linked inventory items
    const { data: inventoryItems } = await this.supabase
      .from('inventory_items')
      .select('id, item_name, set_number, listing_value, cost')
      .eq('purchase_id', purchase.id);

    // Fetch linked BrickLink uploads
    const { data: uploads } = await this.supabase
      .from('bricklink_uploads')
      .select('id, reference, selling_price, cost')
      .eq('purchase_id', purchase.id);

    const items = inventoryItems ?? [];
    const brickLinkItems = uploads ?? [];
    const totalItems = items.length + brickLinkItems.length;

    if (totalItems === 0) {
      return { ...base, itemCount: 0, skipped: true, skipReason: 'no_linked_items', changes: [] };
    }

    // Build unified list of allocatable items
    type AllocItem = {
      id: string;
      type: 'inventory_item' | 'bricklink_upload';
      name: string;
      listingValue: number;
      oldCost: number;
    };

    const allocItems: AllocItem[] = [];

    for (const item of items) {
      const lv = Number(item.listing_value) || 0;
      if (lv > 0) {
        allocItems.push({
          id: item.id,
          type: 'inventory_item',
          name: item.item_name || item.set_number || item.id,
          listingValue: lv,
          oldCost: Number(item.cost) || 0,
        });
      }
    }

    for (const upload of brickLinkItems) {
      const sp = Number(upload.selling_price) || 0;
      if (sp > 0) {
        allocItems.push({
          id: upload.id,
          type: 'bricklink_upload',
          name: upload.reference || upload.id,
          listingValue: sp,
          oldCost: Number(upload.cost) || 0,
        });
      }
    }

    if (allocItems.length === 0) {
      return {
        ...base,
        itemCount: totalItems,
        skipped: true,
        skipReason: 'no_listing_values',
        changes: [],
      };
    }

    const totalListingValue = allocItems.reduce((sum, i) => sum + i.listingValue, 0);

    // Calculate proportional costs with rounding
    const allocated = allocItems.map((item) => {
      const rawCost = (item.listingValue / totalListingValue) * purchaseCost;
      return { ...item, newCost: Math.round(rawCost * 100) / 100 };
    });

    // Fix rounding remainder - apply to highest-value item
    const allocatedSum = allocated.reduce((sum, i) => sum + i.newCost, 0);
    const roundedPurchaseCost = Math.round(purchaseCost * 100) / 100;
    const remainder = Math.round((roundedPurchaseCost - allocatedSum) * 100) / 100;

    if (remainder !== 0) {
      // Find highest-value item
      const maxIdx = allocated.reduce(
        (best, item, idx) => (item.listingValue > allocated[best].listingValue ? idx : best),
        0
      );
      allocated[maxIdx].newCost = Math.round((allocated[maxIdx].newCost + remainder) * 100) / 100;
    }

    // Detect changes and update
    const changes: CostChange[] = [];

    for (const item of allocated) {
      const oldRounded = Math.round(item.oldCost * 100) / 100;
      const newRounded = Math.round(item.newCost * 100) / 100;

      if (oldRounded !== newRounded) {
        // Update the database
        const table =
          item.type === 'inventory_item' ? 'inventory_items' : 'bricklink_uploads';

        await this.supabase
          .from(table)
          .update({ cost: item.newCost })
          .eq('id', item.id);

        changes.push({
          id: item.id,
          type: item.type,
          name: item.name,
          listingValue: item.listingValue,
          oldCost: oldRounded,
          newCost: newRounded,
          change: Math.round((newRounded - oldRounded) * 100) / 100,
        });
      }
    }

    return {
      ...base,
      totalListingValue,
      itemCount: allocItems.length,
      skipped: false,
      changes,
    };
  }

  /**
   * Paginated fetch of all purchases for a user (1000-row pages).
   */
  async fetchAllPurchases(userId: string): Promise<PurchaseRow[]> {
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    const allPurchases: PurchaseRow[] = [];

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('purchases')
        .select('id, cost, description, source')
        .eq('user_id', userId)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.error('[CostAllocation] Failed to fetch purchases page:', error.message);
        break;
      }

      allPurchases.push(...(data ?? []));
      hasMore = (data?.length ?? 0) === pageSize;
      page++;
    }

    return allPurchases;
  }
}

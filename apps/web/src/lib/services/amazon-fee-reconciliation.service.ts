/**
 * Amazon Fee Reconciliation Service
 *
 * Updates sold inventory items with fee data from amazon_transactions table.
 * This reconciles the financial breakdown (fees, gross amount, net amount)
 * that wasn't available at the time of order sync.
 *
 * The amazon_transactions table is populated by the Finance API sync, which
 * has detailed fee breakdowns that aren't available in the Orders API.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

/** Transaction row structure from amazon_transactions table */
interface AmazonTransactionRow {
  amazon_order_id: string | null;
  transaction_type: string;
  transaction_status?: string | null;
  posted_date?: string | null;
  total_amount: number;
  net_amount: number | null;
  total_fees: number | null;
  gross_sales_amount: number | null;
  referral_fee: number | null;
  fba_fulfillment_fee: number | null;
  fba_per_unit_fee: number | null;
  fba_weight_fee: number | null;
  shipping_credit: number | null;
  other_fees: number | null;
  quantity: number | null;
  asin: string | null;
}

/**
 * Deduplicate transactions - prefer RELEASED over DEFERRED for same order+type
 * This prevents double-counting when both DEFERRED and RELEASED exist for the same sale
 */
function deduplicateTransactions(transactions: AmazonTransactionRow[]): AmazonTransactionRow[] {
  const transactionMap = new Map<string, AmazonTransactionRow>();

  for (const tx of transactions) {
    // Key by order_id + transaction_type (if order exists)
    const key = tx.amazon_order_id
      ? `${tx.amazon_order_id}_${tx.transaction_type}`
      : `unknown_${tx.total_amount}_${tx.transaction_type}`;

    const existing = transactionMap.get(key);
    if (!existing) {
      transactionMap.set(key, tx);
    } else {
      // Prefer RELEASED over DEFERRED
      if (tx.transaction_status === 'RELEASED' && existing.transaction_status === 'DEFERRED') {
        transactionMap.set(key, tx);
      }
      // If both are same status, keep the more recent one
      else if (tx.transaction_status === existing.transaction_status) {
        const txDate = tx.posted_date ? new Date(tx.posted_date) : new Date(0);
        const existingDate = existing.posted_date ? new Date(existing.posted_date) : new Date(0);
        if (txDate > existingDate) {
          transactionMap.set(key, tx);
        }
      }
    }
  }

  return Array.from(transactionMap.values());
}

export interface FeeReconciliationResult {
  success: boolean;
  itemsProcessed: number;
  itemsUpdated: number;
  itemsSkipped: number;
  errors: string[];
}

export interface ReconciliationItem {
  inventoryId: string;
  setNumber: string;
  soldOrderId: string;
  platformOrderId: string;
  currentSoldPrice: number | null;
  currentNetAmount: number | null;
  transactionNetAmount: number | null;
  transactionTotalFees: number | null;
  transactionGrossAmount: number | null;
  updated: boolean;
}

export class AmazonFeeReconciliationService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Reconcile fees for sold Amazon inventory items.
   * Joins inventory_items (via sold_order_id) -> platform_orders -> amazon_transactions
   * and updates the financial breakdown fields.
   *
   * @param userId - The user ID to reconcile for
   * @param reconcileAll - If true, reconcile ALL sold Amazon items (not just those missing fees)
   */
  async reconcileFees(userId: string, reconcileAll = false): Promise<FeeReconciliationResult> {
    const result: FeeReconciliationResult = {
      success: false,
      itemsProcessed: 0,
      itemsUpdated: 0,
      itemsSkipped: 0,
      errors: [],
    };

    try {
      // Find sold Amazon inventory items with pagination (Supabase max 1000 rows)
      // If reconcileAll is true, get ALL sold Amazon items
      // Otherwise, only get items missing fee data (sold_fees_amount is null or 0)
      const PAGE_SIZE = 1000;
      let page = 0;
      let hasMore = true;
      const itemsToReconcile: Array<{
        id: string;
        set_number: string;
        sold_order_id: string | null;
        sold_price: number | null;
        sold_gross_amount: number | null;
        sold_fees_amount: number | null;
        sold_net_amount: number | null;
        sold_postage_received: number | null;
      }> = [];

      while (hasMore) {
        let query = this.supabase
          .from('inventory_items')
          .select(
            `
            id,
            set_number,
            sold_order_id,
            sold_price,
            sold_gross_amount,
            sold_fees_amount,
            sold_net_amount,
            sold_postage_received
          `
          )
          .eq('user_id', userId)
          .eq('status', 'SOLD')
          .eq('sold_platform', 'amazon')
          .not('sold_order_id', 'is', null)
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        // Only filter for missing fees if not reconciling all
        if (!reconcileAll) {
          query = query.or('sold_fees_amount.is.null,sold_fees_amount.eq.0');
        }

        const { data, error: fetchError } = await query;

        if (fetchError) {
          result.errors.push(
            `Failed to fetch inventory items page ${page + 1}: ${fetchError.message}`
          );
          return result;
        }

        itemsToReconcile.push(...(data ?? []));
        hasMore = (data?.length ?? 0) === PAGE_SIZE;
        page++;
      }

      console.log(
        `[AmazonFeeReconciliation] Fetched ${itemsToReconcile.length} total inventory items across ${page} pages`
      );

      if (!itemsToReconcile || itemsToReconcile.length === 0) {
        result.success = true;
        return result;
      }

      console.log(`[AmazonFeeReconciliation] Found ${itemsToReconcile.length} items to reconcile`);

      // Get the sold_order_ids - these could be either:
      // 1. Internal UUIDs (from new orders that went through the fulfilment flow)
      // 2. Amazon order IDs directly (from legacy/imported data)
      const soldOrderIds = [
        ...new Set(itemsToReconcile.map((item) => item.sold_order_id).filter(Boolean)),
      ];

      // Separate UUIDs from Amazon order IDs (Amazon order IDs are like "206-1234567-1234567")
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const amazonOrderIdPattern = /^\d{3}-\d{7}-\d{7}$/;

      const uuids: string[] = [];
      const directAmazonOrderIds: string[] = [];

      for (const id of soldOrderIds) {
        if (uuidPattern.test(id as string)) {
          uuids.push(id as string);
        } else if (amazonOrderIdPattern.test(id as string)) {
          directAmazonOrderIds.push(id as string);
        }
      }

      // Fetch platform orders for UUIDs to get their Amazon order IDs
      let platformOrders: Array<{ id: string; platform_order_id: string }> = [];
      if (uuids.length > 0) {
        const { data, error: ordersError } = await this.supabase
          .from('platform_orders')
          .select('id, platform_order_id')
          .in('id', uuids);

        if (ordersError) {
          result.errors.push(`Failed to fetch platform orders: ${ordersError.message}`);
          return result;
        }
        platformOrders = data ?? [];
      }

      // Create a map of sold_order_id to Amazon order ID
      // For UUIDs: map internal ID -> platform_order_id
      // For direct Amazon order IDs: map directly
      const orderIdMap = new Map<string, string>();
      for (const order of platformOrders) {
        orderIdMap.set(order.id, order.platform_order_id);
      }
      for (const amazonOrderId of directAmazonOrderIds) {
        orderIdMap.set(amazonOrderId, amazonOrderId);
      }

      // Get unique Amazon order IDs
      const amazonOrderIds = [...new Set(Array.from(orderIdMap.values()))];

      // Fetch transactions in batches (Supabase IN clause has limits)
      const BATCH_SIZE = 100;
      const allTransactions: AmazonTransactionRow[] = [];

      for (let i = 0; i < amazonOrderIds.length; i += BATCH_SIZE) {
        const batch = amazonOrderIds.slice(i, i + BATCH_SIZE);
        const { data: transactions, error: txError } = await this.supabase
          .from('amazon_transactions')
          .select(
            `
            amazon_order_id,
            transaction_type,
            transaction_status,
            posted_date,
            total_amount,
            net_amount,
            total_fees,
            gross_sales_amount,
            referral_fee,
            fba_fulfillment_fee,
            fba_per_unit_fee,
            fba_weight_fee,
            shipping_credit,
            other_fees,
            quantity,
            asin
          `
          )
          .eq('user_id', userId)
          .in('transaction_type', ['Shipment', 'Sale'])
          .in('amazon_order_id', batch);

        if (txError) {
          result.errors.push(
            `Failed to fetch transactions batch ${i / BATCH_SIZE + 1}: ${txError.message}`
          );
          continue;
        }

        if (transactions) {
          allTransactions.push(...(transactions as AmazonTransactionRow[]));
        }
      }

      console.log(
        `[AmazonFeeReconciliation] Fetched ${allTransactions.length} transactions for ${amazonOrderIds.length} orders`
      );

      // Deduplicate transactions - prefer RELEASED over DEFERRED for same order+type
      // This prevents double-counting when both DEFERRED and RELEASED exist for the same sale
      const dedupedTransactions = deduplicateTransactions(allTransactions);
      console.log(
        `[AmazonFeeReconciliation] After deduplication: ${dedupedTransactions.length} transactions`
      );

      // Create a map of Amazon order ID to transaction data
      // For multi-item orders, we might have multiple transactions per order
      const transactionsByOrderId = new Map<string, AmazonTransactionRow[]>();
      for (const tx of dedupedTransactions) {
        if (tx.amazon_order_id) {
          const existing = transactionsByOrderId.get(tx.amazon_order_id) || [];
          existing.push(tx);
          transactionsByOrderId.set(tx.amazon_order_id, existing);
        }
      }

      // Process each inventory item
      for (const item of itemsToReconcile) {
        result.itemsProcessed++;

        if (!item.sold_order_id) {
          result.itemsSkipped++;
          continue;
        }

        const amazonOrderId = orderIdMap.get(item.sold_order_id);
        if (!amazonOrderId) {
          result.itemsSkipped++;
          continue;
        }

        const orderTransactions = transactionsByOrderId.get(amazonOrderId);
        if (!orderTransactions || orderTransactions.length === 0) {
          result.itemsSkipped++;
          continue;
        }

        // For single-item orders, use the transaction directly
        // For multi-item orders, we'd need to match by ASIN - but most LEGO orders are single item
        // For now, if there's one transaction, use it; if multiple, prorate equally
        let netAmount: number;
        let totalFees: number;
        let grossAmount: number;
        let shippingCredit: number;

        if (orderTransactions.length === 1) {
          const tx = orderTransactions[0];
          netAmount = tx.net_amount ?? tx.total_amount ?? 0;
          totalFees = tx.total_fees ?? 0;
          grossAmount = tx.gross_sales_amount ?? netAmount + totalFees;
          shippingCredit = tx.shipping_credit ?? 0;
        } else {
          // Multiple transactions - sum them all (could be partial shipments)
          netAmount = orderTransactions.reduce(
            (sum, tx) => sum + (tx.net_amount ?? tx.total_amount ?? 0),
            0
          );
          totalFees = orderTransactions.reduce((sum, tx) => sum + (tx.total_fees ?? 0), 0);
          grossAmount = orderTransactions.reduce(
            (sum, tx) => sum + (tx.gross_sales_amount ?? 0),
            0
          );
          shippingCredit = orderTransactions.reduce(
            (sum, tx) => sum + (tx.shipping_credit ?? 0),
            0
          );

          // If gross wasn't calculated in transactions, derive it
          if (grossAmount === 0) {
            grossAmount = netAmount + totalFees;
          }
        }

        // Update the inventory item with reconciled fee data
        const { error: updateError } = await this.supabase
          .from('inventory_items')
          .update({
            sold_gross_amount: grossAmount,
            sold_fees_amount: totalFees,
            sold_net_amount: netAmount,
            sold_postage_received: shippingCredit > 0 ? shippingCredit : item.sold_postage_received,
          })
          .eq('id', item.id)
          .eq('user_id', userId);

        if (updateError) {
          result.errors.push(`Failed to update item ${item.id}: ${updateError.message}`);
          continue;
        }

        result.itemsUpdated++;
        console.log(
          `[AmazonFeeReconciliation] Updated ${item.set_number}: fees=${totalFees}, net=${netAmount}`
        );
      }

      result.success = result.errors.length === 0;
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(errorMsg);
      return result;
    }
  }

  /**
   * Get a preview of items that would be reconciled
   */
  async getReconciliationPreview(userId: string): Promise<ReconciliationItem[]> {
    const preview: ReconciliationItem[] = [];

    // Find items missing fee data
    const { data: items } = await this.supabase
      .from('inventory_items')
      .select(
        `
        id,
        set_number,
        sold_order_id,
        sold_price,
        sold_net_amount
      `
      )
      .eq('user_id', userId)
      .eq('status', 'SOLD')
      .eq('sold_platform', 'amazon')
      .not('sold_order_id', 'is', null)
      .or('sold_fees_amount.is.null,sold_fees_amount.eq.0')
      .limit(50);

    if (!items || items.length === 0) {
      return preview;
    }

    // Get sold_order_ids - could be UUIDs or direct Amazon order IDs
    const soldOrderIds = [...new Set(items.map((i) => i.sold_order_id).filter(Boolean))];

    // Separate UUIDs from direct Amazon order IDs
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const amazonOrderIdPattern = /^\d{3}-\d{7}-\d{7}$/;

    const uuids: string[] = [];
    const directAmazonOrderIds: string[] = [];

    for (const id of soldOrderIds) {
      if (uuidPattern.test(id as string)) {
        uuids.push(id as string);
      } else if (amazonOrderIdPattern.test(id as string)) {
        directAmazonOrderIds.push(id as string);
      }
    }

    // Fetch platform orders for UUIDs
    let orders: Array<{ id: string; platform_order_id: string }> = [];
    if (uuids.length > 0) {
      const { data } = await this.supabase
        .from('platform_orders')
        .select('id, platform_order_id')
        .in('id', uuids);
      orders = data ?? [];
    }

    // Build the order ID map
    const orderMap = new Map<string, string>();
    for (const order of orders) {
      orderMap.set(order.id, order.platform_order_id);
    }
    for (const amazonOrderId of directAmazonOrderIds) {
      orderMap.set(amazonOrderId, amazonOrderId);
    }

    // Get transactions with status info for deduplication
    const amazonOrderIds = [...new Set(Array.from(orderMap.values()))];
    const { data: transactions } = await this.supabase
      .from('amazon_transactions')
      .select(
        'amazon_order_id, transaction_type, transaction_status, posted_date, net_amount, total_fees, gross_sales_amount, total_amount, referral_fee, fba_fulfillment_fee, fba_per_unit_fee, fba_weight_fee, shipping_credit, other_fees, quantity, asin'
      )
      .eq('user_id', userId)
      .in('transaction_type', ['Shipment', 'Sale'])
      .in('amazon_order_id', amazonOrderIds);

    // Deduplicate transactions before processing
    const dedupedTransactions = deduplicateTransactions(
      (transactions ?? []) as AmazonTransactionRow[]
    );

    const txMap = new Map<string, { net: number; fees: number; gross: number }>();
    for (const tx of dedupedTransactions) {
      if (tx.amazon_order_id) {
        const existing = txMap.get(tx.amazon_order_id);
        if (existing) {
          existing.net += tx.net_amount ?? 0;
          existing.fees += tx.total_fees ?? 0;
          existing.gross += tx.gross_sales_amount ?? 0;
        } else {
          txMap.set(tx.amazon_order_id, {
            net: tx.net_amount ?? 0,
            fees: tx.total_fees ?? 0,
            gross: tx.gross_sales_amount ?? 0,
          });
        }
      }
    }

    // Build preview
    for (const item of items) {
      const amazonOrderId = item.sold_order_id ? orderMap.get(item.sold_order_id) : undefined;
      const txData = amazonOrderId ? txMap.get(amazonOrderId) : undefined;

      preview.push({
        inventoryId: item.id,
        setNumber: item.set_number,
        soldOrderId: item.sold_order_id ?? '',
        platformOrderId: amazonOrderId ?? '',
        currentSoldPrice: item.sold_price,
        currentNetAmount: item.sold_net_amount,
        transactionNetAmount: txData?.net ?? null,
        transactionTotalFees: txData?.fees ?? null,
        transactionGrossAmount: txData?.gross ?? null,
        updated: false,
      });
    }

    return preview;
  }
}

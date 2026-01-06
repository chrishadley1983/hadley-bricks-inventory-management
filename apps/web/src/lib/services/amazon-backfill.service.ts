/**
 * Amazon Order Items Backfill Service
 *
 * Background job service that fetches order items for orders that are missing them.
 * Uses rate limiting and batching to avoid hitting Amazon API limits.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, PlatformOrder, OrderItemInsert } from '@hadley-bricks/database';
import { AmazonClient, AmazonRateLimitError } from '../amazon';
import type { AmazonCredentials } from '../amazon';
import { OrderRepository, CredentialsRepository } from '../repositories';

export interface BackfillProgress {
  /** Total orders needing backfill */
  total: number;
  /** Orders processed so far */
  processed: number;
  /** Orders successfully updated */
  success: number;
  /** Orders that failed */
  failed: number;
  /** Whether backfill is currently running */
  isRunning: boolean;
  /** When backfill started */
  startedAt: Date | null;
  /** Estimated time remaining in seconds */
  estimatedSecondsRemaining: number | null;
  /** Current order being processed */
  currentOrderId: string | null;
  /** Any errors encountered */
  errors: string[];
}

export interface BackfillOptions {
  /** Maximum orders to process in this batch (default: 50) */
  batchSize?: number;
  /** Delay between API calls in ms (default: 1000) */
  delayMs?: number;
  /** Whether to skip orders that already have items (default: true) */
  skipWithItems?: boolean;
}

// In-memory progress tracking (per user)
const progressMap = new Map<string, BackfillProgress>();

/**
 * Service for backfilling Amazon order items
 */
export class AmazonBackfillService {
  private orderRepo: OrderRepository;
  private credentialsRepo: CredentialsRepository;

  constructor(private supabase: SupabaseClient<Database>) {
    this.orderRepo = new OrderRepository(supabase);
    this.credentialsRepo = new CredentialsRepository(supabase);
  }

  /**
   * Get the current backfill progress for a user
   */
  getProgress(userId: string): BackfillProgress {
    return (
      progressMap.get(userId) || {
        total: 0,
        processed: 0,
        success: 0,
        failed: 0,
        isRunning: false,
        startedAt: null,
        estimatedSecondsRemaining: null,
        currentOrderId: null,
        errors: [],
      }
    );
  }

  /**
   * Get orders that need item backfill
   * Uses pagination to handle >1000 orders
   */
  async getOrdersNeedingBackfill(userId: string): Promise<PlatformOrder[]> {
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    const allOrders: PlatformOrder[] = [];

    while (hasMore) {
      // Get orders where items_count is 0 or NULL
      const { data, error } = await this.supabase
        .from('platform_orders')
        .select('*')
        .eq('user_id', userId)
        .eq('platform', 'amazon')
        .or('items_count.eq.0,items_count.is.null')
        .order('order_date', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        throw new Error(`Failed to fetch orders needing backfill: ${error.message}`);
      }

      const orders = (data ?? []) as PlatformOrder[];
      allOrders.push(...orders);
      hasMore = orders.length === pageSize;
      page++;
    }

    return allOrders;
  }

  /**
   * Count orders needing backfill
   */
  async countOrdersNeedingBackfill(userId: string): Promise<number> {
    // Count orders where items_count is 0 or NULL
    const { count, error } = await this.supabase
      .from('platform_orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('platform', 'amazon')
      .or('items_count.eq.0,items_count.is.null');

    if (error) {
      throw new Error(`Failed to count orders: ${error.message}`);
    }

    return count ?? 0;
  }

  /**
   * Start the backfill process
   */
  async startBackfill(userId: string, options: BackfillOptions = {}): Promise<BackfillProgress> {
    const { batchSize = 50, delayMs = 1000 } = options;

    // Check if already running
    const existing = progressMap.get(userId);
    if (existing?.isRunning) {
      return existing;
    }

    // Get Amazon client
    const credentials = await this.credentialsRepo.getCredentials<AmazonCredentials>(
      userId,
      'amazon'
    );

    if (!credentials) {
      throw new Error('Amazon credentials not configured');
    }

    const client = new AmazonClient(credentials);

    // Get orders needing backfill
    const ordersToProcess = await this.getOrdersNeedingBackfill(userId);

    if (ordersToProcess.length === 0) {
      return {
        total: 0,
        processed: 0,
        success: 0,
        failed: 0,
        isRunning: false,
        startedAt: null,
        estimatedSecondsRemaining: null,
        currentOrderId: null,
        errors: [],
      };
    }

    // Limit to batch size
    const batch = ordersToProcess.slice(0, batchSize);

    // Initialize progress
    const progress: BackfillProgress = {
      total: batch.length,
      processed: 0,
      success: 0,
      failed: 0,
      isRunning: true,
      startedAt: new Date(),
      estimatedSecondsRemaining: (batch.length * delayMs) / 1000,
      currentOrderId: null,
      errors: [],
    };
    progressMap.set(userId, progress);

    // Process in background (don't await)
    this.processBackfillBatch(userId, client, batch, delayMs).catch((err) => {
      console.error('[AmazonBackfillService] Background batch error:', err);
      const p = progressMap.get(userId);
      if (p) {
        p.isRunning = false;
        p.errors.push(err instanceof Error ? err.message : 'Unknown error');
      }
    });

    return progress;
  }

  /**
   * Process a batch of orders (runs in background)
   */
  private async processBackfillBatch(
    userId: string,
    client: AmazonClient,
    orders: PlatformOrder[],
    delayMs: number
  ): Promise<void> {
    const progress = progressMap.get(userId);
    if (!progress) return;

    const startTime = Date.now();

    for (const order of orders) {
      if (!progress.isRunning) {
        // User cancelled
        break;
      }

      progress.currentOrderId = order.platform_order_id;

      try {
        // Fetch order items from Amazon
        const items = await client.getOrderItems(order.platform_order_id);

        if (items.length > 0) {
          // Normalize and save items
          const itemInserts: Omit<OrderItemInsert, 'order_id'>[] = items.map((item) => ({
            item_number: item.ASIN,
            item_name: item.Title || 'Unknown',
            item_type: 'set',
            quantity: item.QuantityOrdered,
            unit_price: item.ItemPrice?.Amount ? parseFloat(item.ItemPrice.Amount) : null,
            total_price: item.ItemPrice?.Amount
              ? parseFloat(item.ItemPrice.Amount) * item.QuantityOrdered
              : null,
            currency: item.ItemPrice?.CurrencyCode || 'GBP',
          }));

          // Replace items and update count
          await this.orderRepo.replaceOrderItems(order.id, itemInserts);

          // Update items_count on order
          await this.supabase
            .from('platform_orders')
            .update({ items_count: items.length })
            .eq('id', order.id);

          progress.success++;
        } else {
          // No items found (might be FBA or cancelled)
          progress.success++;
        }
      } catch (error) {
        progress.failed++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        progress.errors.push(`Order ${order.platform_order_id}: ${errorMsg}`);

        // If rate limited, wait longer
        if (error instanceof AmazonRateLimitError) {
          const waitTime = Math.max(delayMs * 2, 2000);
          console.log(`[AmazonBackfillService] Rate limited, waiting ${waitTime}ms...`);
          await this.sleep(waitTime);
        }
      }

      progress.processed++;

      // Update estimated time remaining
      const elapsed = Date.now() - startTime;
      const avgTimePerOrder = elapsed / progress.processed;
      const remaining = orders.length - progress.processed;
      progress.estimatedSecondsRemaining = Math.round((remaining * avgTimePerOrder) / 1000);

      // Delay between requests
      if (progress.processed < orders.length) {
        await this.sleep(delayMs);
      }
    }

    progress.isRunning = false;
    progress.currentOrderId = null;
    console.log(
      `[AmazonBackfillService] Backfill complete: ${progress.success} success, ${progress.failed} failed`
    );
  }

  /**
   * Stop the backfill process
   */
  stopBackfill(userId: string): void {
    const progress = progressMap.get(userId);
    if (progress) {
      progress.isRunning = false;
    }
  }

  /**
   * Clear the backfill progress
   */
  clearProgress(userId: string): void {
    progressMap.delete(userId);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

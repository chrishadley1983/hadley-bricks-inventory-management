/**
 * eBay Inventory Linking Service
 *
 * Automatically links eBay order line items to inventory items when orders are fulfilled.
 * Uses exact SKU matching for auto-linking, with fuzzy matching suggestions for manual resolution.
 *
 * Design decisions:
 * - FIFO: Prefer older inventory items (by purchase date)
 * - Auto-link: Only when exact unique SKU match AND quantity = 1
 * - Multi-quantity: Always flag for manual resolution
 * - Fuzzy matches: Suggested to user, never auto-linked
 *
 * @see docs/plans/ebay-inventory-linking-refactor.md
 */

import { createClient as createServerClient } from '@/lib/supabase/server';
import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

export interface MatchResult {
  status: 'matched' | 'manual_required' | 'unmatched';
  method?: 'auto_sku' | 'manual';
  inventoryId?: string;
  confidence?: number;
  reason?: ResolutionReason;
  candidates?: RankedCandidate[];
  quantityNeeded?: number;
}

export type ResolutionReason =
  | 'no_sku'
  | 'no_matches'
  | 'multiple_sku_matches'
  | 'fuzzy_set_number'
  | 'fuzzy_title'
  | 'multi_quantity';

export interface RankedCandidate {
  id: string;
  sku: string | null;
  set_number: string | null;
  item_name: string | null;
  condition: string | null;
  storage_location: string | null;
  listing_value: number | null;
  cost: number | null;
  purchase_date: string | null;
  status: string;
  score: number;
  reasons: string[];
}

export interface NetSaleCalculation {
  grossAmount: number;
  feesAmount: number | null;
  postageReceived: number | null;
  netAmount: number | null;
  status: 'calculated' | 'pending_transaction' | 'no_transaction';
}

export interface LinkingResult {
  orderId: string;
  status: 'complete' | 'partial' | 'pending';
  lineItemsProcessed: number;
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
  includeSold?: boolean; // Include already-sold items in matching (for legacy data)
  includePaid?: boolean; // Also process PAID orders (not yet fulfilled) for pre-linking
  onProgress?: (current: number, total: number, autoLinked: number, queued: number) => void;
}

interface EbayOrderLineItem {
  id: string;
  order_id: string;
  sku: string | null;
  title: string;
  quantity: number;
  total_amount: number;
  inventory_item_id: string | null;
}

interface EbayOrder {
  id: string;
  user_id: string;
  ebay_order_id: string;
  creation_date: string;
  order_fulfilment_status: string;
  inventory_link_status: string | null;
}

interface InventoryItem {
  id: string;
  sku: string | null;
  set_number: string | null;
  item_name: string | null;
  condition: string | null;
  storage_location: string | null;
  listing_value: number | null;
  cost: number | null;
  purchase_date: string | null;
  status: string;
}

// EbayTransaction interface removed - was unused

// ============================================================================
// Service Class
// ============================================================================

export class EbayInventoryLinkingService {
  // Using 'any' for supabase because the types.ts file may not include the latest columns
  // from migration 20250108000003_ebay_inventory_linking.sql
  // Regenerate types with `npm run db:types` when possible
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
   * By default: BACKLOG, LISTED (items available for sale)
   * With includeSold: also includes SOLD items that don't have an ebay_line_item_id yet
   *
   * Note: Status values in DB are: NOT YET RECEIVED, BACKLOG, LISTED, SOLD, RETURNED
   * BACKLOG = items ready to list or sell (replaces legacy 'IN STOCK')
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
   * Process a PAID order - attempt to pre-link line items to inventory for pick list display
   * Unlike fulfilled orders, this does NOT mark inventory as SOLD
   */
  async processPaidOrder(orderId: string): Promise<LinkingResult> {
    const result: LinkingResult = {
      orderId,
      status: 'pending',
      lineItemsProcessed: 0,
      autoLinked: 0,
      queuedForResolution: 0,
      errors: [],
    };

    try {
      // Get order with line items
      const { data: order, error: orderError } = await this.supabase
        .from('ebay_orders')
        .select('id, user_id, ebay_order_id, creation_date, order_fulfilment_status, order_payment_status')
        .eq('id', orderId)
        .eq('user_id', this.userId)
        .single();

      if (orderError || !order) {
        result.errors.push(`Order not found: ${orderId}`);
        return result;
      }

      // Get line items that haven't been linked yet
      const { data: lineItems, error: lineItemsError } = await this.supabase
        .from('ebay_order_line_items')
        .select('id, order_id, sku, title, quantity, total_amount, inventory_item_id')
        .eq('order_id', orderId)
        .is('inventory_item_id', null);

      if (lineItemsError) {
        result.errors.push(`Failed to fetch line items: ${lineItemsError.message}`);
        return result;
      }

      if (!lineItems || lineItems.length === 0) {
        // All items already linked
        result.status = 'complete';
        return result;
      }

      // Process each line item
      for (const lineItem of lineItems) {
        result.lineItemsProcessed++;

        const matchResult = await this.matchLineItemToInventory(lineItem);

        if (matchResult.status === 'matched' && matchResult.inventoryId) {
          // Pre-link successful - link line item to inventory but DON'T mark as sold
          await this.linkLineItemToInventory(lineItem.id, matchResult.inventoryId, matchResult.method!);
          result.autoLinked++;
        } else {
          // Add to resolution queue for manual pre-linking
          await this.addToResolutionQueue(lineItem, order, matchResult);
          result.queuedForResolution++;
        }
      }

      // Update order linking status
      const allLinked = result.queuedForResolution === 0;
      const someLinked = result.autoLinked > 0;

      result.status = allLinked ? 'complete' : someLinked ? 'partial' : 'pending';

      await this.supabase
        .from('ebay_orders')
        .update({
          inventory_link_status: result.status,
          // Don't set inventory_linked_at for PAID orders - only when fulfilled
        })
        .eq('id', orderId);

      return result;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      return result;
    }
  }

  /**
   * Process a fulfilled order - attempt to link all line items to inventory
   */
  async processFulfilledOrder(orderId: string): Promise<LinkingResult> {
    const result: LinkingResult = {
      orderId,
      status: 'pending',
      lineItemsProcessed: 0,
      autoLinked: 0,
      queuedForResolution: 0,
      errors: [],
    };

    try {
      // Get order with line items
      const { data: order, error: orderError } = await this.supabase
        .from('ebay_orders')
        .select('id, user_id, ebay_order_id, creation_date, order_fulfilment_status')
        .eq('id', orderId)
        .eq('user_id', this.userId)
        .single();

      if (orderError || !order) {
        result.errors.push(`Order not found: ${orderId}`);
        return result;
      }

      // Get line items that haven't been linked yet
      const { data: lineItems, error: lineItemsError } = await this.supabase
        .from('ebay_order_line_items')
        .select('id, order_id, sku, title, quantity, total_amount, inventory_item_id')
        .eq('order_id', orderId)
        .is('inventory_item_id', null);

      if (lineItemsError) {
        result.errors.push(`Failed to fetch line items: ${lineItemsError.message}`);
        return result;
      }

      if (!lineItems || lineItems.length === 0) {
        // All items already linked
        result.status = 'complete';
        return result;
      }

      // Process each line item
      for (const lineItem of lineItems) {
        result.lineItemsProcessed++;

        const matchResult = await this.matchLineItemToInventory(lineItem);

        if (matchResult.status === 'matched' && matchResult.inventoryId) {
          // Auto-link successful
          const netSale = await this.calculateNetSale(order.ebay_order_id, lineItem);
          await this.markInventoryAsSold(matchResult.inventoryId, lineItem, order, netSale);
          await this.linkLineItemToInventory(lineItem.id, matchResult.inventoryId, matchResult.method!);
          result.autoLinked++;
        } else {
          // Add to resolution queue
          await this.addToResolutionQueue(lineItem, order, matchResult);
          result.queuedForResolution++;
        }
      }

      // Update order linking status
      const allLinked = result.queuedForResolution === 0;
      const someLinked = result.autoLinked > 0;

      result.status = allLinked ? 'complete' : someLinked ? 'partial' : 'pending';

      await this.supabase
        .from('ebay_orders')
        .update({
          inventory_link_status: result.status,
          inventory_linked_at: allLinked ? new Date().toISOString() : null,
        })
        .eq('id', orderId);

      return result;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      return result;
    }
  }

  /**
   * Process all historical fulfilled orders that haven't been linked
   * @param options.includeSold - Include already-sold items in matching (for legacy data)
   * @param options.includePaid - Also process PAID orders (not yet fulfilled) for pre-linking
   */
  async processHistoricalOrders(options: ProcessingOptions = {}): Promise<BulkLinkingResult> {
    // Set the includeSold flag for this processing run
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

    // Get all fulfilled orders without inventory linking - with pagination to handle >1000 orders
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    const allFulfilledOrders: Array<{ id: string; ebay_order_id: string; creation_date: string; type: 'fulfilled' }> = [];

    while (hasMore) {
      const { data: orders, error } = await this.supabase
        .from('ebay_orders')
        .select('id, ebay_order_id, creation_date')
        .eq('user_id', this.userId)
        .eq('order_fulfilment_status', 'FULFILLED')
        .is('inventory_link_status', null)
        .order('creation_date', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        result.errors.push(`Failed to fetch fulfilled orders page ${page}: ${error.message}`);
        break;
      }

      allFulfilledOrders.push(...(orders || []).map((o: { id: string; ebay_order_id: string; creation_date: string }) => ({ ...o, type: 'fulfilled' as const })));
      hasMore = (orders?.length || 0) === pageSize;
      page++;
    }

    // Also get PAID orders if requested
    const allPaidOrders: Array<{ id: string; ebay_order_id: string; creation_date: string; type: 'paid' }> = [];
    if (options.includePaid) {
      page = 0;
      hasMore = true;

      while (hasMore) {
        const { data: orders, error } = await this.supabase
          .from('ebay_orders')
          .select('id, ebay_order_id, creation_date')
          .eq('user_id', this.userId)
          .eq('order_payment_status', 'PAID')
          .neq('order_fulfilment_status', 'FULFILLED') // Exclude already fulfilled
          .is('inventory_link_status', null)
          .order('creation_date', { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
          result.errors.push(`Failed to fetch paid orders page ${page}: ${error.message}`);
          break;
        }

        allPaidOrders.push(...(orders || []).map((o: { id: string; ebay_order_id: string; creation_date: string }) => ({ ...o, type: 'paid' as const })));
        hasMore = (orders?.length || 0) === pageSize;
        page++;
      }
    }

    // Combine and process all orders
    const allOrders = [...allFulfilledOrders, ...allPaidOrders];

    console.log(`[EbayInventoryLinking] Processing ${allFulfilledOrders.length} fulfilled + ${allPaidOrders.length} paid orders`);

    const totalOrders = allOrders.length;

    for (const order of allOrders) {
      // Use appropriate processor based on order type
      const linkingResult = order.type === 'paid'
        ? await this.processPaidOrder(order.id)
        : await this.processFulfilledOrder(order.id);

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

      // Call progress callback if provided
      if (options.onProgress) {
        options.onProgress(
          result.ordersProcessed,
          totalOrders,
          result.totalAutoLinked,
          result.totalQueuedForResolution
        );
      }

      if (linkingResult.errors.length > 0) {
        result.errors.push(...linkingResult.errors.map(e => `Order ${order.ebay_order_id}: ${e}`));
      }
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Matching Algorithm
  // --------------------------------------------------------------------------

  /**
   * Attempt to match a line item to inventory
   */
  async matchLineItemToInventory(lineItem: EbayOrderLineItem): Promise<MatchResult> {
    const { sku, title, quantity } = lineItem;

    // Step 0: Multi-quantity always goes to manual resolution
    if (quantity > 1) {
      const candidates = await this.findCandidates(sku, title);
      return {
        status: 'manual_required',
        reason: 'multi_quantity',
        candidates: this.rankCandidates(candidates, lineItem),
        quantityNeeded: quantity,
      };
    }

    // Step 1: Exact SKU match (ONLY auto-link scenario)
    if (sku) {
      const matches = await this.findBySku(sku);
      if (matches.length === 1) {
        // AUTO-LINK: Single exact SKU match
        return {
          status: 'matched',
          method: 'auto_sku',
          inventoryId: matches[0].id,
          confidence: 1.0,
        };
      }
      if (matches.length > 1) {
        // Multiple SKU matches - user must choose (FIFO ranking applied)
        return {
          status: 'manual_required',
          reason: 'multiple_sku_matches',
          candidates: this.rankCandidates(matches, lineItem),
        };
      }
    }

    // Step 2: Fuzzy match by set number extracted from title (suggest only, no auto-link)
    const setNumber = this.extractSetNumber(title);
    if (setNumber) {
      const matches = await this.findBySetNumber(setNumber);
      if (matches.length > 0) {
        return {
          status: 'manual_required',
          reason: 'fuzzy_set_number',
          candidates: this.rankCandidates(matches, lineItem),
        };
      }
    }

    // Step 3: Title keyword search (suggest only, no auto-link)
    const titleMatches = await this.searchByTitle(title);
    if (titleMatches.length > 0) {
      return {
        status: 'manual_required',
        reason: 'fuzzy_title',
        candidates: this.rankCandidates(titleMatches, lineItem),
      };
    }

    // No matches found at all
    return {
      status: 'unmatched',
      reason: sku ? 'no_matches' : 'no_sku',
      candidates: [],
    };
  }

  // --------------------------------------------------------------------------
  // Inventory Search Methods
  // --------------------------------------------------------------------------

  /**
   * Find inventory items by exact SKU match
   * When includeSold is true, also matches SOLD items that don't have an ebay_line_item_id yet
   */
  private async findBySku(sku: string): Promise<InventoryItem[]> {
    const query = this.supabase
      .from('inventory_items')
      .select('id, sku, set_number, item_name, condition, storage_location, listing_value, cost, purchase_date, status, ebay_line_item_id')
      .eq('user_id', this.userId)
      .eq('sku', sku)
      .in('status', this.getValidStatuses())
      .order('purchase_date', { ascending: true }); // FIFO

    const { data } = await query;

    // Filter out SOLD items that already have an ebay_line_item_id
    return (data || []).filter((item: InventoryItem & { ebay_line_item_id?: string }) =>
      item.status !== 'SOLD' || !item.ebay_line_item_id
    );
  }

  /**
   * Find inventory items by set number
   * When includeSold is true, also matches SOLD items that don't have an ebay_line_item_id yet
   */
  private async findBySetNumber(setNumber: string): Promise<InventoryItem[]> {
    const { data } = await this.supabase
      .from('inventory_items')
      .select('id, sku, set_number, item_name, condition, storage_location, listing_value, cost, purchase_date, status, ebay_line_item_id')
      .eq('user_id', this.userId)
      .eq('set_number', setNumber)
      .in('status', this.getValidStatuses())
      .order('purchase_date', { ascending: true }); // FIFO

    // Filter out SOLD items that already have an ebay_line_item_id
    return (data || []).filter((item: InventoryItem & { ebay_line_item_id?: string }) =>
      item.status !== 'SOLD' || !item.ebay_line_item_id
    );
  }

  /**
   * Search inventory by title keywords
   * When includeSold is true, also matches SOLD items that don't have an ebay_line_item_id yet
   */
  private async searchByTitle(title: string): Promise<InventoryItem[]> {
    // Extract meaningful keywords from title (remove common words)
    const keywords = this.extractKeywords(title);
    if (keywords.length === 0) return [];

    // Search using ilike for each keyword
    const searchTerm = keywords.slice(0, 3).join(' ');

    const { data } = await this.supabase
      .from('inventory_items')
      .select('id, sku, set_number, item_name, condition, storage_location, listing_value, cost, purchase_date, status, ebay_line_item_id')
      .eq('user_id', this.userId)
      .in('status', this.getValidStatuses())
      .ilike('item_name', `%${searchTerm}%`)
      .order('purchase_date', { ascending: true })
      .limit(20);

    // Filter out SOLD items that already have an ebay_line_item_id
    return (data || []).filter((item: InventoryItem & { ebay_line_item_id?: string }) =>
      item.status !== 'SOLD' || !item.ebay_line_item_id
    );
  }

  /**
   * Find candidates using both SKU and title
   */
  private async findCandidates(sku: string | null, title: string): Promise<InventoryItem[]> {
    const candidates: InventoryItem[] = [];
    const seenIds = new Set<string>();

    // Try SKU first
    if (sku) {
      const skuMatches = await this.findBySku(sku);
      for (const match of skuMatches) {
        if (!seenIds.has(match.id)) {
          candidates.push(match);
          seenIds.add(match.id);
        }
      }
    }

    // Try set number from title
    const setNumber = this.extractSetNumber(title);
    if (setNumber) {
      const setMatches = await this.findBySetNumber(setNumber);
      for (const match of setMatches) {
        if (!seenIds.has(match.id)) {
          candidates.push(match);
          seenIds.add(match.id);
        }
      }
    }

    // Try title search
    const titleMatches = await this.searchByTitle(title);
    for (const match of titleMatches) {
      if (!seenIds.has(match.id)) {
        candidates.push(match);
        seenIds.add(match.id);
      }
    }

    return candidates;
  }

  // --------------------------------------------------------------------------
  // Candidate Ranking
  // --------------------------------------------------------------------------

  /**
   * Rank candidates by relevance using FIFO and other factors
   */
  private rankCandidates(candidates: InventoryItem[], lineItem: EbayOrderLineItem): RankedCandidate[] {
    return candidates
      .map((item) => {
        const { score, reasons } = this.calculateScore(item, lineItem);
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
    lineItem: EbayOrderLineItem
  ): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // SKU exact match (30 points)
    if (item.sku && lineItem.sku && item.sku === lineItem.sku) {
      score += 30;
      reasons.push('Exact SKU match');
    }

    // Status: LISTED preferred over BACKLOG (20 points)
    if (item.status === 'LISTED') {
      score += 20;
      reasons.push('Status: LISTED');
    } else if (item.status === 'BACKLOG') {
      score += 10;
      reasons.push('Status: BACKLOG');
    }

    // Condition match (15 points)
    const lineItemCondition = this.extractCondition(lineItem.title);
    if (lineItemCondition && item.condition) {
      const normalizedItemCondition = item.condition.toLowerCase().includes('new') ? 'new' : 'used';
      if (lineItemCondition === normalizedItemCondition) {
        score += 15;
        reasons.push(`Condition match: ${item.condition}`);
      }
    }

    // Has storage location (10 points)
    if (item.storage_location) {
      score += 10;
      reasons.push(`Location: ${item.storage_location}`);
    }

    // Price proximity (15 points max)
    if (item.listing_value && lineItem.total_amount) {
      const priceDiff = Math.abs(item.listing_value - lineItem.total_amount);
      const priceRatio = priceDiff / lineItem.total_amount;
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

    // FIFO bonus (10 points max) - older items get more points
    if (item.purchase_date) {
      const purchaseDate = new Date(item.purchase_date);
      const daysSincePurchase = Math.floor(
        (Date.now() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      // Items older than 180 days get full bonus
      const fifoScore = Math.min(10, Math.floor(daysSincePurchase / 18));
      if (fifoScore > 0) {
        score += fifoScore;
        reasons.push(`FIFO: ${daysSincePurchase} days old`);
      }
    }

    return { score, reasons };
  }

  // --------------------------------------------------------------------------
  // Text Extraction Helpers
  // --------------------------------------------------------------------------

  /**
   * Extract LEGO set number from title (e.g., "75192", "10294")
   */
  private extractSetNumber(title: string): string | null {
    // Match 4-6 digit numbers that look like LEGO set numbers
    const matches = title.match(/\b(\d{4,6})\b/g);
    if (!matches) return null;

    // Filter out years (1990-2030) and other unlikely numbers
    const validSetNumbers = matches.filter((num) => {
      const n = parseInt(num, 10);
      // Exclude years and very small/large numbers
      return n >= 100 && (n < 1990 || n > 2030) && n < 100000;
    });

    return validSetNumbers[0] || null;
  }

  /**
   * Extract condition from title (New/Used/Sealed etc.)
   */
  private extractCondition(title: string): 'new' | 'used' | null {
    const lowerTitle = title.toLowerCase();
    if (
      lowerTitle.includes('new') ||
      lowerTitle.includes('sealed') ||
      lowerTitle.includes('nisb') ||
      lowerTitle.includes('misb')
    ) {
      return 'new';
    }
    if (lowerTitle.includes('used') || lowerTitle.includes('opened') || lowerTitle.includes('built')) {
      return 'used';
    }
    return null;
  }

  /**
   * Extract meaningful keywords from title
   */
  private extractKeywords(title: string): string[] {
    const stopWords = new Set([
      'lego',
      'the',
      'a',
      'an',
      'and',
      'or',
      'new',
      'used',
      'sealed',
      'set',
      'with',
      'for',
      'in',
      'of',
      'to',
      'from',
      'by',
      'free',
      'shipping',
      'fast',
      'uk',
      'brand',
    ]);

    return title
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word));
  }

  // --------------------------------------------------------------------------
  // Net Sale Calculation
  // --------------------------------------------------------------------------

  /**
   * Calculate net sale amount from transaction data
   */
  async calculateNetSale(ebayOrderId: string, lineItem: EbayOrderLineItem): Promise<NetSaleCalculation> {
    // Get transaction for this order
    const { data: transaction } = await this.supabase
      .from('ebay_transactions')
      .select(
        'ebay_order_id, total_fee_amount, final_value_fee_fixed, final_value_fee_variable, regulatory_operating_fee, international_fee, ad_fee, postage_and_packaging'
      )
      .eq('user_id', this.userId)
      .eq('ebay_order_id', ebayOrderId)
      .eq('transaction_type', 'SALE')
      .single();

    if (!transaction) {
      return {
        grossAmount: lineItem.total_amount,
        feesAmount: null,
        postageReceived: null,
        netAmount: null,
        status: 'pending_transaction',
      };
    }

    // Calculate total fees
    const totalFees =
      (transaction.final_value_fee_fixed || 0) +
      (transaction.final_value_fee_variable || 0) +
      (transaction.regulatory_operating_fee || 0) +
      (transaction.international_fee || 0) +
      (transaction.ad_fee || 0);

    const postage = transaction.postage_and_packaging || 0;

    // For single-item orders, fees apply directly
    // For multi-item orders, we'd need to proportion fees (but multi-qty goes to manual anyway)
    const netAmount = lineItem.total_amount - totalFees;

    return {
      grossAmount: lineItem.total_amount,
      feesAmount: totalFees,
      postageReceived: postage,
      netAmount,
      status: 'calculated',
    };
  }

  // --------------------------------------------------------------------------
  // Database Updates
  // --------------------------------------------------------------------------

  /**
   * Mark an inventory item as sold with sale details
   */
  private async markInventoryAsSold(
    inventoryId: string,
    lineItem: EbayOrderLineItem,
    order: EbayOrder,
    netSale: NetSaleCalculation
  ): Promise<void> {
    await this.supabase
      .from('inventory_items')
      .update({
        status: 'SOLD',
        sold_date: order.creation_date,
        sold_at: new Date().toISOString(),
        sold_price: lineItem.total_amount,
        sold_platform: 'ebay',
        sold_order_id: order.ebay_order_id,
        sold_gross_amount: netSale.grossAmount,
        sold_fees_amount: netSale.feesAmount,
        sold_postage_received: netSale.postageReceived,
        sold_net_amount: netSale.netAmount,
        ebay_line_item_id: lineItem.id,
        storage_location: null, // Clear storage location when sold
      })
      .eq('id', inventoryId)
      .eq('user_id', this.userId);
  }

  /**
   * Link a line item to an inventory item
   */
  private async linkLineItemToInventory(
    lineItemId: string,
    inventoryId: string,
    method: 'auto_sku' | 'manual'
  ): Promise<void> {
    await this.supabase
      .from('ebay_order_line_items')
      .update({
        inventory_item_id: inventoryId,
        inventory_linked_at: new Date().toISOString(),
        inventory_link_method: method,
      })
      .eq('id', lineItemId);
  }

  /**
   * Add a line item to the resolution queue
   */
  private async addToResolutionQueue(
    lineItem: EbayOrderLineItem,
    order: EbayOrder,
    matchResult: MatchResult
  ): Promise<void> {
    // Prepare candidates JSON
    const candidatesJson = matchResult.candidates?.map((c) => ({
      id: c.id,
      sku: c.sku,
      set_number: c.set_number,
      item_name: c.item_name,
      condition: c.condition,
      storage_location: c.storage_location,
      listing_value: c.listing_value,
      cost: c.cost,
      purchase_date: c.purchase_date,
      status: c.status,
      score: c.score,
      reasons: c.reasons,
    }));

    await this.supabase.from('ebay_inventory_resolution_queue').upsert(
      {
        user_id: this.userId,
        ebay_line_item_id: lineItem.id,
        ebay_order_id: lineItem.order_id,
        sku: lineItem.sku,
        title: lineItem.title,
        quantity: lineItem.quantity,
        total_amount: lineItem.total_amount,
        order_date: order.creation_date,
        status: 'pending',
        resolution_reason: matchResult.reason || 'no_matches',
        match_candidates: candidatesJson || [],
        quantity_needed: matchResult.quantityNeeded || 1,
      },
      {
        onConflict: 'ebay_line_item_id',
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
    // Get the queue item
    const { data: queueItem, error: queueError } = await this.supabase
      .from('ebay_inventory_resolution_queue')
      .select('*, ebay_order_line_items!inner(*), ebay_orders!inner(*)')
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

    // Get order and line item data
    const lineItem = queueItem.ebay_order_line_items as unknown as EbayOrderLineItem;
    const order = queueItem.ebay_orders as unknown as EbayOrder;

    // For each inventory item, mark as sold
    for (let i = 0; i < inventoryItemIds.length; i++) {
      const inventoryId = inventoryItemIds[i];

      // Calculate proportional amounts for multi-quantity
      const proportion = 1 / queueItem.quantity_needed;
      const itemAmount = queueItem.total_amount * proportion;

      const netSale = await this.calculateNetSale(order.ebay_order_id, {
        ...lineItem,
        total_amount: itemAmount,
      });

      await this.markInventoryAsSold(
        inventoryId,
        { ...lineItem, total_amount: itemAmount },
        order,
        netSale
      );
    }

    // Link the first inventory item to the line item (for single-qty, this is the only one)
    await this.linkLineItemToInventory(lineItem.id, inventoryItemIds[0], 'manual');

    // Update queue item as resolved
    await this.supabase
      .from('ebay_inventory_resolution_queue')
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
   * Skip a queue item (no inventory to link)
   */
  async skipQueueItem(
    queueItemId: string,
    reason: 'skipped' | 'no_inventory'
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await this.supabase
      .from('ebay_inventory_resolution_queue')
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

    return { success: true };
  }

  /**
   * Update order linking status based on line items
   */
  private async updateOrderLinkStatus(orderId: string): Promise<void> {
    // Get all line items for this order
    const { data: lineItems } = await this.supabase
      .from('ebay_order_line_items')
      .select('id, inventory_item_id')
      .eq('order_id', orderId);

    // Get pending queue items
    const { data: pendingQueue } = await this.supabase
      .from('ebay_inventory_resolution_queue')
      .select('id')
      .eq('ebay_order_id', orderId)
      .eq('status', 'pending');

    const totalItems = lineItems?.length || 0;
    const linkedItems = lineItems?.filter((li: { inventory_item_id: string | null }) => li.inventory_item_id !== null).length || 0;
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
      .from('ebay_orders')
      .update({
        inventory_link_status: status,
        inventory_linked_at: status === 'complete' ? new Date().toISOString() : null,
      })
      .eq('id', orderId);
  }

  // --------------------------------------------------------------------------
  // Statistics
  // --------------------------------------------------------------------------

  /**
   * Get linking statistics
   */
  async getStats(): Promise<{
    totalFulfilledOrders: number;
    linkedOrders: number;
    partialOrders: number;
    pendingOrders: number;
    pendingQueueItems: number;
  }> {
    const { data: orders } = await this.supabase
      .from('ebay_orders')
      .select('inventory_link_status')
      .eq('user_id', this.userId)
      .eq('order_fulfilment_status', 'FULFILLED');

    const { count: pendingQueueItems } = await this.supabase
      .from('ebay_inventory_resolution_queue')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', this.userId)
      .eq('status', 'pending');

    type OrderWithLinkStatus = { inventory_link_status: string | null };
    const stats = {
      totalFulfilledOrders: orders?.length || 0,
      linkedOrders: orders?.filter((o: OrderWithLinkStatus) => o.inventory_link_status === 'complete').length || 0,
      partialOrders: orders?.filter((o: OrderWithLinkStatus) => o.inventory_link_status === 'partial').length || 0,
      pendingOrders: orders?.filter((o: OrderWithLinkStatus) => !o.inventory_link_status || o.inventory_link_status === 'pending').length || 0,
      pendingQueueItems: pendingQueueItems || 0,
    };

    return stats;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createEbayInventoryLinkingService(): Promise<EbayInventoryLinkingService | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  return new EbayInventoryLinkingService(supabase, user.id);
}

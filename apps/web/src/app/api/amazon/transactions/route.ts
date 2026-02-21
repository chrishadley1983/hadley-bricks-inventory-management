import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  transactionType: z.string().optional(),
  marketplace: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  search: z.string().optional(),
  sortBy: z
    .enum(['purchase_date', 'posted_date', 'total_amount', 'item_title', 'asin'])
    .default('purchase_date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// Type for transaction row from database
interface AmazonTransactionRow {
  id: string;
  amazon_transaction_id: string;
  amazon_order_id: string | null;
  transaction_type: string;
  transaction_status: string | null;
  posted_date: string;
  total_amount: number;
  gross_sales_amount: number | null;
  total_fees: number | null;
  item_title: string | null;
  asin: string | null;
  [key: string]: unknown;
}

// Type for enriched transaction with order data
interface EnrichedAmazonTransaction extends AmazonTransactionRow {
  // From platform_orders
  purchase_date: string | null;
  // From order_items (first/primary item)
  product_name: string | null;
  order_asin: string | null;
}

/**
 * Deduplicate transactions - prefer RELEASED over DEFERRED for same order+type
 * This prevents double-counting when both DEFERRED and RELEASED exist for the same sale
 */
function deduplicateTransactions<T extends AmazonTransactionRow>(transactions: T[]): T[] {
  const transactionMap = new Map<string, T>();

  for (const tx of transactions) {
    // Key by order_id + transaction_type (if order exists), otherwise use the transaction_id
    const key = tx.amazon_order_id
      ? `${tx.amazon_order_id}_${tx.transaction_type}`
      : tx.amazon_transaction_id;

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
        if (new Date(tx.posted_date) > new Date(existing.posted_date)) {
          transactionMap.set(key, tx);
        }
      }
    }
  }

  return Array.from(transactionMap.values());
}

/**
 * GET /api/amazon/transactions
 * Query Amazon transactions with filtering and pagination
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const params = {
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
      transactionType: searchParams.get('transactionType') ?? undefined,
      marketplace: searchParams.get('marketplace') ?? undefined,
      fromDate: searchParams.get('fromDate') ?? undefined,
      toDate: searchParams.get('toDate') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      sortBy: searchParams.get('sortBy') ?? undefined,
      sortOrder: searchParams.get('sortOrder') ?? undefined,
    };

    const parsed = QuerySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      page,
      pageSize,
      transactionType,
      marketplace,
      fromDate,
      toDate,
      search,
      sortBy,
      sortOrder,
    } = parsed.data;

    // Helper to build query with filters
    // Note: Date filtering (fromDate/toDate) is applied AFTER enrichment using purchase_date
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyFilters = (baseQuery: any) => {
      let q = baseQuery.eq('user_id', user.id);

      if (transactionType) {
        q = q.eq('transaction_type', transactionType);
      }
      if (marketplace) {
        q = q.eq('marketplace_id', marketplace);
      }
      // Date filtering moved to after enrichment to use purchase_date
      if (search) {
        q = q.or(
          `asin.ilike.%${search}%,seller_sku.ilike.%${search}%,amazon_order_id.ilike.%${search}%,item_title.ilike.%${search}%`
        );
      }

      return q;
    };

    // First, get ALL transactions matching filters (for deduplication)
    // We need to fetch all to properly dedupe DEFERRED/RELEASED
    const allTransactions: AmazonTransactionRow[] = [];
    const fetchPageSize = 1000;
    let fetchOffset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error: fetchError } = await applyFilters(
        supabase.from('amazon_transactions').select('*')
      )
        .order('posted_date', { ascending: sortOrder === 'asc' })
        .range(fetchOffset, fetchOffset + fetchPageSize - 1);

      if (fetchError) {
        console.error('[GET /api/amazon/transactions] Fetch error:', fetchError);
        return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
      }

      allTransactions.push(...(data as AmazonTransactionRow[]));
      hasMore = data?.length === fetchPageSize;
      fetchOffset += fetchPageSize;
    }

    // Deduplicate - prefer RELEASED over DEFERRED for same order
    const dedupedTransactions = deduplicateTransactions(allTransactions);

    // Enrich transactions with order data (purchase_date, product_name, asin from orders)
    const orderIds = dedupedTransactions
      .map((tx) => tx.amazon_order_id)
      .filter((id): id is string => id !== null);

    // Fetch matching platform_orders with order_items
    const orderDataMap = new Map<
      string,
      { purchase_date: string | null; product_name: string | null; order_asin: string | null }
    >();

    if (orderIds.length > 0) {
      // Batch fetch orders - get unique order IDs
      const uniqueOrderIds = [...new Set(orderIds)];

      // Fetch orders in batches of 100 to avoid query limits
      const orderBatchSize = 100;
      for (let i = 0; i < uniqueOrderIds.length; i += orderBatchSize) {
        const batchOrderIds = uniqueOrderIds.slice(i, i + orderBatchSize);

        const { data: orders, error: ordersError } = await supabase
          .from('platform_orders')
          .select(
            `
            id,
            platform_order_id,
            order_date,
            order_items (
              item_name,
              item_number
            )
          `
          )
          .eq('user_id', user.id)
          .eq('platform', 'amazon')
          .in('platform_order_id', batchOrderIds);

        if (ordersError) {
          console.error('[GET /api/amazon/transactions] Orders fetch error:', ordersError);
          // Continue without order enrichment rather than failing
        } else if (orders) {
          for (const order of orders) {
            // Get the first order item for product name and ASIN
            const firstItem = Array.isArray(order.order_items) ? order.order_items[0] : null;

            orderDataMap.set(order.platform_order_id, {
              purchase_date: order.order_date,
              product_name: firstItem?.item_name || null,
              order_asin: firstItem?.item_number || null,
            });
          }
        }
      }
    }

    // Enrich transactions with order data
    const enrichedTransactions: EnrichedAmazonTransaction[] = dedupedTransactions.map((tx) => {
      const orderData = tx.amazon_order_id ? orderDataMap.get(tx.amazon_order_id) : null;

      return {
        ...tx,
        purchase_date: orderData?.purchase_date ?? null,
        product_name: orderData?.product_name ?? null,
        order_asin: orderData?.order_asin ?? null,
      };
    });

    // Apply date filtering using purchase_date (with fallback to posted_date)
    // This must be done after enrichment since purchase_date comes from platform_orders
    let filteredTransactions = enrichedTransactions;

    if (fromDate || toDate) {
      const fromTime = fromDate ? new Date(fromDate).getTime() : 0;
      const toTime = toDate
        ? new Date(toDate).getTime() + 24 * 60 * 60 * 1000 - 1 // End of day
        : Infinity;

      filteredTransactions = enrichedTransactions.filter((tx) => {
        // Use purchase_date if available, fallback to posted_date
        const txDate = tx.purchase_date || tx.posted_date;
        const txTime = new Date(txDate).getTime();
        return txTime >= fromTime && txTime <= toTime;
      });
    }

    // Sort the filtered transactions
    // Use purchase_date (from order) if available, fall back to posted_date (from transaction)
    filteredTransactions.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'purchase_date') {
        const aDate = a.purchase_date || a.posted_date;
        const bDate = b.purchase_date || b.posted_date;
        comparison = new Date(aDate).getTime() - new Date(bDate).getTime();
      } else if (sortBy === 'posted_date') {
        comparison = new Date(a.posted_date).getTime() - new Date(b.posted_date).getTime();
      } else if (sortBy === 'total_amount') {
        comparison = (a.total_amount || 0) - (b.total_amount || 0);
      } else if (sortBy === 'item_title') {
        comparison = (a.item_title || '').localeCompare(b.item_title || '');
      } else if (sortBy === 'asin') {
        comparison = (a.asin || '').localeCompare(b.asin || '');
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    // Apply pagination to filtered results
    const total = filteredTransactions.length;
    const offset = (page - 1) * pageSize;
    const transactions = filteredTransactions.slice(offset, offset + pageSize);

    // Calculate summary totals from filtered transactions (no double counting)
    let totalSales = 0;
    let totalFees = 0;
    let totalRefunds = 0;

    // Debug: count transaction types
    const typeCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};
    let shipmentCount = 0;

    for (const tx of filteredTransactions) {
      typeCounts[tx.transaction_type] = (typeCounts[tx.transaction_type] || 0) + 1;
      statusCounts[tx.transaction_status || 'null'] =
        (statusCounts[tx.transaction_status || 'null'] || 0) + 1;

      if (tx.transaction_type === 'Shipment') {
        shipmentCount++;
        // Use gross_sales_amount if available, otherwise calculate from net + fees
        const gross =
          tx.gross_sales_amount ?? (tx.total_amount || 0) + Math.abs(tx.total_fees || 0);
        totalSales += gross;
        totalFees += Math.abs(tx.total_fees || 0);
      } else if (tx.transaction_type === 'Refund') {
        totalRefunds += Math.abs(tx.total_amount || 0);
      } else if (
        tx.transaction_type === 'ServiceFee' ||
        tx.transaction_type === 'FBAInventoryFee'
      ) {
        // Standalone fee transactions
        totalFees += Math.abs(tx.total_amount || 0);
      }
    }

    console.log('[GET /api/amazon/transactions] Summary debug:', {
      totalFetched: enrichedTransactions.length,
      totalFiltered: filteredTransactions.length,
      shipmentCount,
      typeCounts,
      statusCounts,
      totalSales,
      totalFees,
      totalRefunds,
      dateFilter: { fromDate, toDate },
    });

    return NextResponse.json({
      transactions,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      summary: {
        totalSales,
        totalFees,
        totalRefunds,
        netRevenue: totalSales - totalRefunds - totalFees,
      },
    });
  } catch (error) {
    console.error('[GET /api/amazon/transactions] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch transactions',
      },
      { status: 500 }
    );
  }
}

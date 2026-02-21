/**
 * Inventory Stock API Route for Set Lookup
 *
 * GET - Fetch inventory stock data for a LEGO set (by set number or ASIN)
 * Returns current stock and sold stock counts, split by condition (New/Used)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';

const QuerySchema = z.object({
  setNumber: z.string().min(1, 'Set number is required'),
  asin: z.string().nullable().optional(),
});

export interface InventoryStockItem {
  id: string;
  setNumber: string;
  itemName: string | null;
  condition: 'New' | 'Used' | null;
  status: string | null;
  cost: number | null;
  listingValue: number | null;
  listingPlatform: string | null;
  listingDate: string | null;
  soldPrice: number | null;
  soldDate: string | null;
  soldPlatform: string | null;
  storageLocation: string | null;
  sku: string | null;
  amazonAsin: string | null;
}

export interface InventoryStockSummary {
  currentStock: {
    new: number;
    used: number;
    total: number;
  };
  soldStock: {
    new: number;
    used: number;
    total: number;
  };
  items: InventoryStockItem[];
}

export interface InventoryStockResponse {
  data: InventoryStockSummary;
  setNumber: string;
  searchedAt: string;
}

/**
 * GET /api/brickset/inventory-stock
 * Fetch inventory stock for a set
 */
export async function GET(request: NextRequest) {
  try {
    // Validate auth via API key or session cookie
    const auth = await validateAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service role client for API key auth (bypasses RLS)
    const isApiKeyAuth = !!request.headers.get('x-api-key');
    const supabase = isApiKeyAuth ? createServiceRoleClient() : await createClient();
    const userId = auth.userId;

    // Parse query parameters
    const url = new URL(request.url);
    const params = {
      setNumber: url.searchParams.get('setNumber'),
      asin: url.searchParams.get('asin'),
    };

    const parsed = QuerySchema.safeParse(params);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { setNumber, asin } = parsed.data;

    // Normalize set number (remove variant suffix for search)
    const baseSetNumber = setNumber.split('-')[0];

    console.log(
      `[GET /api/brickset/inventory-stock] Searching for set: ${baseSetNumber}, asin: ${asin || 'none'}`
    );

    // Build query to search by set_number OR amazon_asin
    // Use ilike for set_number to match variants (e.g., 75192, 75192-1)
    let query = supabase
      .from('inventory_items')
      .select(
        'id, set_number, item_name, condition, status, cost, listing_value, listing_platform, listing_date, sold_price, sold_date, sold_platform, storage_location, sku, amazon_asin'
      )
      .eq('user_id', userId);

    // Search by set number (with variants) OR by ASIN if provided
    if (asin) {
      query = query.or(`set_number.ilike.${baseSetNumber}%,amazon_asin.eq.${asin}`);
    } else {
      query = query.ilike('set_number', `${baseSetNumber}%`);
    }

    const { data: items, error: queryError } = await query;

    if (queryError) {
      console.error('[GET /api/brickset/inventory-stock] Query error:', queryError);
      return NextResponse.json({ error: 'Failed to fetch inventory' }, { status: 500 });
    }

    // Transform and calculate summary
    const transformedItems: InventoryStockItem[] = (items || []).map((item) => ({
      id: item.id,
      setNumber: item.set_number,
      itemName: item.item_name,
      condition: item.condition as 'New' | 'Used' | null,
      status: item.status,
      cost: item.cost != null ? Number(item.cost) : null,
      listingValue: item.listing_value != null ? Number(item.listing_value) : null,
      listingPlatform: item.listing_platform,
      listingDate: item.listing_date,
      soldPrice: item.sold_price != null ? Number(item.sold_price) : null,
      soldDate: item.sold_date,
      soldPlatform: item.sold_platform,
      storageLocation: item.storage_location,
      sku: item.sku,
      amazonAsin: item.amazon_asin,
    }));

    // Calculate stock counts
    // Current stock = BACKLOG or LISTED (not yet sold)
    // Sold stock = SOLD
    const currentStockItems = transformedItems.filter(
      (item) => item.status === 'BACKLOG' || item.status === 'LISTED'
    );
    const soldStockItems = transformedItems.filter((item) => item.status === 'SOLD');

    const summary: InventoryStockSummary = {
      currentStock: {
        new: currentStockItems.filter((item) => item.condition === 'New').length,
        used: currentStockItems.filter((item) => item.condition === 'Used').length,
        total: currentStockItems.length,
      },
      soldStock: {
        new: soldStockItems.filter((item) => item.condition === 'New').length,
        used: soldStockItems.filter((item) => item.condition === 'Used').length,
        total: soldStockItems.length,
      },
      items: transformedItems,
    };

    console.log(
      `[GET /api/brickset/inventory-stock] Found ${transformedItems.length} items (${summary.currentStock.total} current, ${summary.soldStock.total} sold)`
    );

    return NextResponse.json({
      data: summary,
      setNumber,
      searchedAt: new Date().toISOString(),
    } as InventoryStockResponse);
  } catch (error) {
    console.error('[GET /api/brickset/inventory-stock] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

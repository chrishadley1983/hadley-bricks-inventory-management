import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/inventory/search-unlinked
 * Search inventory items that are NOT linked to any orders (BrickLink or eBay)
 * Uses an efficient database function instead of client-side exclusion
 */

const QuerySchema = z.object({
  search: z.string().min(1),
  status: z.string().optional(), // Comma-separated statuses like "BACKLOG,LISTED"
  pageSize: z.coerce.number().min(1).max(100).default(20),
  includeSold: z.coerce.boolean().default(false),
});

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

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = QuerySchema.safeParse(searchParams);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { search, status, pageSize, includeSold } = parsed.data;

    // Parse statuses - if includeSold is true, don't filter by status
    let statuses: string[] | undefined = undefined;
    if (!includeSold && status) {
      statuses = status.split(',').map((s) => s.trim());
    }

    if (includeSold) {
      // When including sold items, we don't exclude linked items
      // Just do a regular search
      const query = supabase
        .from('inventory_items')
        .select('id, sku, amazon_asin, set_number, item_name, condition, storage_location, status, cost, listing_value, purchase_date, sold_date, created_at')
        .or(`set_number.ilike.%${search}%,item_name.ilike.%${search}%,sku.ilike.%${search}%`)
        .order('created_at', { ascending: false })
        .limit(pageSize);

      const { data, error } = await query;

      if (error) {
        console.error('[GET /api/inventory/search-unlinked] Query error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ data: data || [] });
    }

    // Use the efficient database function to exclude linked items
    const { data, error } = await supabase.rpc('search_inventory_excluding_linked', {
      p_user_id: user.id,
      p_search_term: search,
      p_statuses: statuses,
      p_page_size: pageSize,
      p_offset: 0,
    });

    if (error) {
      console.error('[GET /api/inventory/search-unlinked] RPC error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('[GET /api/inventory/search-unlinked] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

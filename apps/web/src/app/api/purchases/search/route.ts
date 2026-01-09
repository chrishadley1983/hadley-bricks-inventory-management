import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { PurchaseSearchResult } from '@/lib/api/purchases';

const QuerySchema = z.object({
  q: z.string().min(1, 'Search query is required'),
  limit: z.coerce.number().positive().max(50).optional().default(10),
});

/**
 * GET /api/purchases/search
 * Search purchases by description, reference, or source for the combobox lookup
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

    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());
    const parsed = QuerySchema.safeParse(queryParams);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { q, limit } = parsed.data;
    const searchTerm = `%${q}%`;

    // Search purchases with count of linked inventory items
    const { data, error } = await supabase
      .from('purchases')
      .select(
        `
        id,
        short_description,
        purchase_date,
        cost,
        source,
        reference,
        inventory_items!inventory_items_purchase_id_fkey(count)
      `
      )
      .eq('user_id', user.id)
      .or(`short_description.ilike.${searchTerm},reference.ilike.${searchTerm},source.ilike.${searchTerm}`)
      .order('purchase_date', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[GET /api/purchases/search] Query error:', error);
      return NextResponse.json({ error: 'Failed to search purchases' }, { status: 500 });
    }

    // Transform the response to include items_linked count
    const results: PurchaseSearchResult[] = (data ?? []).map((purchase) => ({
      id: purchase.id,
      short_description: purchase.short_description,
      purchase_date: purchase.purchase_date,
      cost: purchase.cost,
      source: purchase.source,
      reference: purchase.reference,
      items_linked: Array.isArray(purchase.inventory_items)
        ? purchase.inventory_items[0]?.count ?? 0
        : 0,
    }));

    return NextResponse.json({ data: results });
  } catch (error) {
    console.error('[GET /api/purchases/search] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

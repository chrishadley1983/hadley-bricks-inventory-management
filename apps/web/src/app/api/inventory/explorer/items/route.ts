import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const VALID_TYPES = ['Part', 'Set', 'Minifig'];
const VALID_SORT_FIELDS = ['item_name', 'quantity', 'bricqer_price', 'item_number'];
const PAGE_SIZE = 50;

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
    const type = searchParams.get('type') || 'Part';
    const search = searchParams.get('search') || '';
    const condition = searchParams.get('condition');
    const color = searchParams.get('color');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const sortField = searchParams.get('sort') || 'bricqer_price';
    const sortDir = searchParams.get('dir') === 'asc' ? true : false;

    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    // Build query
    let query = supabase
      .from('bricqer_inventory_snapshot')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .eq('item_type', type);

    if (condition && (condition === 'New' || condition === 'Used')) {
      query = query.eq('condition', condition);
    }

    if (color) {
      query = query.eq('color_name', color);
    }

    if (search) {
      query = query.or(`item_name.ilike.%${search}%,item_number.ilike.%${search}%`);
    }

    // Sort
    const safeSortField = VALID_SORT_FIELDS.includes(sortField) ? sortField : 'bricqer_price';
    query = query.order(safeSortField, { ascending: sortDir });

    // Paginate
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) throw error;

    // Also get aggregate stats for the type (paginated to handle >1000 rows)
    let totalItems = 0;
    let totalValue = 0;
    let statsOffset = 0;
    const statsPageSize = 1000;

    while (true) {
      let statsQuery = supabase
        .from('bricqer_inventory_snapshot')
        .select('quantity, bricqer_price')
        .eq('user_id', user.id)
        .eq('item_type', type);

      if (condition && (condition === 'New' || condition === 'Used')) {
        statsQuery = statsQuery.eq('condition', condition);
      }
      if (color) {
        statsQuery = statsQuery.eq('color_name', color);
      }
      if (search) {
        statsQuery = statsQuery.or(`item_name.ilike.%${search}%,item_number.ilike.%${search}%`);
      }

      const { data: statsData } = await statsQuery.range(statsOffset, statsOffset + statsPageSize - 1);

      if (!statsData || statsData.length === 0) break;

      for (const row of statsData) {
        totalItems += row.quantity;
        totalValue += row.bricqer_price * row.quantity;
      }

      if (statsData.length < statsPageSize) break;
      statsOffset += statsPageSize;
    }

    // Get distinct colors for the filter dropdown (only for Parts)
    let colors: string[] = [];
    if (type === 'Part') {
      const { data: colorData } = await supabase
        .from('bricqer_inventory_snapshot')
        .select('color_name')
        .eq('user_id', user.id)
        .eq('item_type', 'Part')
        .not('color_name', 'is', null)
        .order('color_name')
        .limit(500);

      if (colorData) {
        colors = [...new Set(colorData.map((c) => c.color_name).filter(Boolean) as string[])];
      }
    }

    const items = (data || []).map((item) => ({
      id: item.id,
      bricqerItemId: item.bricqer_item_id,
      itemNumber: item.item_number,
      itemName: item.item_name,
      itemType: item.item_type,
      colorId: item.color_id,
      colorName: item.color_name,
      colorRgb: item.color_rgb,
      condition: item.condition,
      quantity: item.quantity,
      price: item.bricqer_price,
      imageUrl: item.image_url,
      storageLocation: item.storage_location,
    }));

    return NextResponse.json({
      data: {
        items,
        totalCount: count || 0,
        totalLots: count || 0,
        totalItems,
        totalValue: Math.round(totalValue * 100) / 100,
        page,
        pageSize: PAGE_SIZE,
        totalPages: Math.ceil((count || 0) / PAGE_SIZE),
        colors,
      },
    });
  } catch (error) {
    console.error('[GET /api/inventory/explorer/items] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

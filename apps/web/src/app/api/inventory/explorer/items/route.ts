import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { fetchBLCache, getSTR, getSold, getForSale, getBLAvg } from '@/lib/inventory-explorer/bricklink-lookup';

const VALID_TYPES = ['Part', 'Set', 'Minifig'];
const PAGE_SIZE = 50;

interface RawRow {
  item_number: string;
  item_name: string;
  item_type: string;
  color_id: number | null;
  color_name: string | null;
  color_rgb: string | null;
  condition: string;
  quantity: number;
  bricqer_price: number;
  image_url: string | null;
  comment: string | null;
}

interface ConsolidatedLot {
  itemNumber: string;
  itemName: string;
  itemType: string;
  colorId: number | null;
  colorName: string | null;
  colorRgb: string | null;
  condition: string;
  quantity: number;
  totalValue: number;
  avgPrice: number;
  imageUrl: string | null;
}

/** Consolidation key: same (item_number, color_id, condition, comment) = same lot */
function lotKey(row: RawRow): string {
  return `${row.item_number}|${row.color_id ?? ''}|${row.condition}|${row.comment ?? ''}`;
}

export async function GET(request: NextRequest) {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'Part';
    const search = searchParams.get('search') || '';
    const condition = searchParams.get('condition');
    const color = searchParams.get('color');
    const enriched = searchParams.get('enriched'); // 'yes', 'no', or null
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const sortField = searchParams.get('sort') || 'totalValue';
    const sortDir = searchParams.get('dir') === 'asc' ? 'asc' : 'desc';

    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    // Fetch ALL rows for this type (paginated for >1000 limit)
    const allRows: RawRow[] = [];
    let offset = 0;
    const fetchSize = 1000;

    while (true) {
      let query = supabase
        .from('bricqer_inventory_snapshot')
        .select('item_number, item_name, item_type, color_id, color_name, color_rgb, condition, quantity, bricqer_price, image_url, comment')
        .eq('user_id', user.id)
        .eq('item_type', type);

      if (condition && (condition === 'New' || condition === 'Used')) {
        query = query.eq('condition', condition);
      }
      if (color) {
        query = query.eq('color_name', color);
      }

      const { data, error } = await query.range(offset, offset + fetchSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < fetchSize) break;
      offset += fetchSize;
    }

    // Consolidate lots
    const lotMap = new Map<string, ConsolidatedLot>();

    for (const row of allRows) {
      const key = lotKey(row);
      const existing = lotMap.get(key);

      if (existing) {
        existing.quantity += row.quantity;
        existing.totalValue += row.bricqer_price * row.quantity;
      } else {
        lotMap.set(key, {
          itemNumber: row.item_number,
          itemName: row.item_name,
          itemType: row.item_type,
          colorId: row.color_id,
          colorName: row.color_name,
          colorRgb: row.color_rgb,
          condition: row.condition,
          quantity: row.quantity,
          totalValue: row.bricqer_price * row.quantity,
          avgPrice: 0,
          imageUrl: row.image_url,
        });
      }
    }

    let lots = Array.from(lotMap.values());

    // Calculate weighted avg price
    for (const lot of lots) {
      lot.avgPrice = lot.quantity > 0 ? lot.totalValue / lot.quantity : 0;
    }

    // Apply search filter on consolidated lots
    if (search) {
      const q = search.toLowerCase();
      lots = lots.filter(
        (lot) =>
          lot.itemName.toLowerCase().includes(q) ||
          lot.itemNumber.toLowerCase().includes(q)
      );
    }

    // Fetch BL cache for enriched filter and data columns
    const blCache = await fetchBLCache(
      supabase,
      lots.map((l) => ({ itemNumber: l.itemNumber, colorId: l.colorId, itemType: l.itemType }))
    );

    // Apply enriched filter
    if (enriched === 'yes') {
      lots = lots.filter((lot) => {
        const blKey = `${lot.itemNumber}|${lot.colorId ?? ''}`;
        const entry = blCache.get(blKey);
        return entry && getSTR(lot.condition, entry) !== null;
      });
    } else if (enriched === 'no') {
      lots = lots.filter((lot) => {
        const blKey = `${lot.itemNumber}|${lot.colorId ?? ''}`;
        const entry = blCache.get(blKey);
        return !entry || getSTR(lot.condition, entry) === null;
      });
    }

    // Aggregate stats (after all filters)
    let totalItems = 0;
    let totalValue = 0;
    for (const lot of lots) {
      totalItems += lot.quantity;
      totalValue += lot.totalValue;
    }
    const totalLots = lots.length;

    // Sort
    const sortFn = (a: ConsolidatedLot, b: ConsolidatedLot): number => {
      let cmp = 0;
      switch (sortField) {
        case 'item_name':
          cmp = a.itemName.localeCompare(b.itemName);
          break;
        case 'quantity':
          cmp = a.quantity - b.quantity;
          break;
        case 'bricqer_price':
        case 'avgPrice':
          cmp = a.avgPrice - b.avgPrice;
          break;
        case 'item_number':
          cmp = a.itemNumber.localeCompare(b.itemNumber);
          break;
        case 'totalValue':
        default:
          cmp = a.totalValue - b.totalValue;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    };

    lots.sort(sortFn);

    // Paginate
    const totalPages = Math.ceil(lots.length / PAGE_SIZE);
    const from = (page - 1) * PAGE_SIZE;
    const pageItems = lots.slice(from, from + PAGE_SIZE);

    // Map to response format with BL data (blCache already fetched above)
    const items = pageItems.map((lot) => {
      const blKey = `${lot.itemNumber}|${lot.colorId ?? ''}`;
      const blEntry = blCache.get(blKey);
      return {
        itemNumber: lot.itemNumber,
        itemName: lot.itemName,
        itemType: lot.itemType,
        colorId: lot.colorId,
        colorName: lot.colorName,
        colorRgb: lot.colorRgb,
        condition: lot.condition,
        quantity: lot.quantity,
        price: Math.round(lot.avgPrice * 100) / 100,
        value: Math.round(lot.totalValue * 100) / 100,
        imageUrl: lot.imageUrl,
        blAvg: getBLAvg(lot.condition, blEntry),
        str: getSTR(lot.condition, blEntry),
        sold: getSold(lot.condition, blEntry),
        forSale: getForSale(lot.condition, blEntry),
      };
    });

    // Get distinct colors for the filter dropdown (Parts only)
    let colors: string[] = [];
    if (type === 'Part') {
      const colorSet = new Set<string>();
      for (const row of allRows) {
        if (row.color_name) colorSet.add(row.color_name);
      }
      colors = Array.from(colorSet).sort();
    }

    return NextResponse.json({
      data: {
        items,
        totalCount: totalLots,
        totalLots,
        totalItems,
        totalValue: Math.round(totalValue * 100) / 100,
        page,
        pageSize: PAGE_SIZE,
        totalPages,
        colors,
      },
    });
  } catch (error) {
    console.error('[GET /api/inventory/explorer/items] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { fetchBLCache, getSTR } from '@/lib/inventory-explorer/bricklink-lookup';

interface RawRow {
  item_type: string;
  condition: string;
  quantity: number;
  bricqer_price: number;
  item_number: string;
  item_name: string;
  color_id: number | null;
  color_name: string | null;
  color_rgb: string | null;
  image_url: string | null;
  comment: string | null;
}

/** Consolidation key: items with same (item_number, color_id, condition, comment) form one lot */
function lotKey(row: RawRow): string {
  return `${row.item_number}|${row.color_id ?? ''}|${row.condition}|${row.comment ?? ''}`;
}

interface ConsolidatedLot {
  itemNumber: string;
  itemName: string;
  itemType: string;
  colorId: number | null;
  colorName: string | null;
  colorRgb: string | null;
  imageUrl: string | null;
  condition: string;
  quantity: number;
  totalValue: number;
  avgPrice: number;
}

export async function GET() {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // Fetch all snapshot rows (paginated for >1000 row limit)
    const allRows: RawRow[] = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await supabase
        .from('bricqer_inventory_snapshot')
        .select('item_type, condition, quantity, bricqer_price, item_number, item_name, color_id, color_name, color_rgb, image_url, comment')
        .eq('user_id', user.id)
        .range(offset, offset + pageSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    // Consolidate into lots: group by (item_number, color_id, condition, comment)
    const lotMap = new Map<string, ConsolidatedLot & { itemType: string }>();

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
          itemType: row.item_type || 'Part',
          colorId: row.color_id,
          colorName: row.color_name,
          colorRgb: row.color_rgb,
          imageUrl: row.image_url,
          condition: row.condition || 'Used',
          quantity: row.quantity,
          totalValue: row.bricqer_price * row.quantity,
          avgPrice: 0, // calculated below
        });
      }
    }

    // Calculate weighted average price per lot
    const lots = Array.from(lotMap.values());
    for (const lot of lots) {
      lot.avgPrice = lot.quantity > 0 ? lot.totalValue / lot.quantity : 0;
    }

    // Aggregate totals
    let totalItems = 0;
    let totalValue = 0;
    const byCondition: Record<string, { items: number; value: number }> = {};
    const byType: Record<string, { items: number; value: number }> = {};

    for (const lot of lots) {
      totalItems += lot.quantity;
      totalValue += lot.totalValue;

      if (!byCondition[lot.condition]) byCondition[lot.condition] = { items: 0, value: 0 };
      byCondition[lot.condition].items += lot.quantity;
      byCondition[lot.condition].value += lot.totalValue;

      if (!byType[lot.itemType]) byType[lot.itemType] = { items: 0, value: 0 };
      byType[lot.itemType].items += lot.quantity;
      byType[lot.itemType].value += lot.totalValue;
    }

    const totalLots = lots.length;

    const conditionBreakdown = Object.entries(byCondition).map(([condition, data]) => ({
      condition,
      items: data.items,
      value: Math.round(data.value * 100) / 100,
      percentage: totalItems > 0 ? Math.round((data.items / totalItems) * 100) : 0,
    }));

    const typeBreakdown = Object.entries(byType)
      .map(([type, data]) => ({
        type,
        items: data.items,
        value: Math.round(data.value * 100) / 100,
        percentage: totalItems > 0 ? Math.round((data.items / totalItems) * 100) : 0,
      }))
      .sort((a, b) => b.items - a.items);

    // Fetch BrickLink cache for all lots
    const blCache = await fetchBLCache(
      supabase,
      lots.map((l) => ({ itemNumber: l.itemNumber, colorId: l.colorId, itemType: l.itemType }))
    );

    // Calculate average STR (weighted by value, only for lots with BL data)
    let strWeightedSum = 0;
    let strValueSum = 0;
    for (const lot of lots) {
      const blKey = `${lot.itemNumber}|${lot.colorId ?? ''}`;
      const blEntry = blCache.get(blKey);
      const str = getSTR(lot.condition, blEntry);
      if (str !== null) {
        strWeightedSum += str * lot.totalValue;
        strValueSum += lot.totalValue;
      }
    }
    const averageSTR = strValueSum > 0 ? Math.round((strWeightedSum / strValueSum) * 10) / 10 : null;

    // Top 10 most valuable consolidated lots (with STR)
    const top10 = lots
      .map((lot) => {
        const blKey = `${lot.itemNumber}|${lot.colorId ?? ''}`;
        const blEntry = blCache.get(blKey);
        return {
          itemNumber: lot.itemNumber,
          itemName: lot.itemName,
          colorName: lot.colorName,
          colorRgb: lot.colorRgb,
          imageUrl: lot.imageUrl,
          condition: lot.condition,
          quantity: lot.quantity,
          avgPrice: Math.round(lot.avgPrice * 100) / 100,
          value: Math.round(lot.totalValue * 100) / 100,
          str: getSTR(lot.condition, blEntry),
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    return NextResponse.json({
      data: {
        totalItems,
        totalLots,
        estimatedValue: Math.round(totalValue * 100) / 100,
        averageSTR,
        conditionBreakdown,
        typeBreakdown,
        top10,
      },
    });
  } catch (error) {
    console.error('[GET /api/inventory/explorer/overview] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

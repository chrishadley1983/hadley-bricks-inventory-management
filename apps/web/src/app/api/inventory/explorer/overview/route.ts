import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all snapshot items (paginated to handle >1000 row limit)
    const allItems: Array<{
      item_type: string;
      condition: string;
      quantity: number;
      bricqer_price: number;
      item_number: string;
      item_name: string;
      color_name: string | null;
      color_rgb: string | null;
      image_url: string | null;
    }> = [];

    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('bricqer_inventory_snapshot')
        .select('item_type, condition, quantity, bricqer_price, item_number, item_name, color_name, color_rgb, image_url')
        .eq('user_id', user.id)
        .range(offset, offset + pageSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      allItems.push(...data);
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    // Aggregate totals
    let totalItems = 0;
    let totalValue = 0;
    const byCondition: Record<string, { items: number; value: number }> = {};
    const byType: Record<string, { items: number; value: number }> = {};

    for (const item of allItems) {
      const qty = item.quantity;
      const value = item.bricqer_price * qty;
      totalItems += qty;
      totalValue += value;

      // By condition
      const cond = item.condition || 'Used';
      if (!byCondition[cond]) byCondition[cond] = { items: 0, value: 0 };
      byCondition[cond].items += qty;
      byCondition[cond].value += value;

      // By type
      const type = item.item_type || 'Part';
      if (!byType[type]) byType[type] = { items: 0, value: 0 };
      byType[type].items += qty;
      byType[type].value += value;
    }

    const totalLots = allItems.length;

    // Condition breakdown with percentages
    const conditionBreakdown = Object.entries(byCondition).map(([condition, data]) => ({
      condition,
      items: data.items,
      value: Math.round(data.value * 100) / 100,
      percentage: totalItems > 0 ? Math.round((data.items / totalItems) * 100) : 0,
    }));

    // Type breakdown with percentages
    const typeBreakdown = Object.entries(byType)
      .map(([type, data]) => ({
        type,
        items: data.items,
        value: Math.round(data.value * 100) / 100,
        percentage: totalItems > 0 ? Math.round((data.items / totalItems) * 100) : 0,
      }))
      .sort((a, b) => b.items - a.items);

    // Top 10 most valuable lots (by total value = price * qty)
    const sortedByValue = [...allItems]
      .map((item) => ({
        itemNumber: item.item_number,
        itemName: item.item_name,
        colorName: item.color_name,
        colorRgb: item.color_rgb,
        imageUrl: item.image_url,
        condition: item.condition,
        quantity: item.quantity,
        avgPrice: item.bricqer_price,
        value: Math.round(item.bricqer_price * item.quantity * 100) / 100,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    return NextResponse.json({
      data: {
        totalItems,
        totalLots,
        estimatedValue: Math.round(totalValue * 100) / 100,
        conditionBreakdown,
        typeBreakdown,
        top10: sortedByValue,
      },
    });
  } catch (error) {
    console.error('[GET /api/inventory/explorer/overview] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

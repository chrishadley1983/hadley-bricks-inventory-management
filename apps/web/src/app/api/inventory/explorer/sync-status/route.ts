import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** 90-day freshness threshold matching enrichment.service.ts */
const FRESH_THRESHOLD_DAYS = 90;

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

    const { data: meta } = await supabase
      .from('bricqer_snapshot_meta')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (!meta) {
      return NextResponse.json({
        data: {
          syncStatus: 'never',
          lastFullSync: null,
          totalItems: 0,
          totalLots: 0,
          syncCursor: 0,
          syncError: null,
          enrichedLots: 0,
          staleLots: 0,
        },
      });
    }

    // Fetch all snapshot rows to compute consolidated lots
    // Consolidation key: (item_number, color_id, condition, comment)
    interface LotInfo {
      itemNumber: string;
      colorId: number | null;
      condition: string;
      totalQty: number;
    }

    const lotMap = new Map<string, LotInfo>();
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data } = await supabase
        .from('bricqer_inventory_snapshot')
        .select('item_number, color_id, condition, comment, quantity')
        .eq('user_id', user.id)
        .range(offset, offset + pageSize - 1);

      if (!data || data.length === 0) break;

      for (const row of data) {
        const key = `${row.item_number}|${row.color_id ?? ''}|${row.condition}|${row.comment ?? ''}`;
        const existing = lotMap.get(key);
        if (existing) {
          existing.totalQty += row.quantity;
        } else {
          lotMap.set(key, {
            itemNumber: row.item_number,
            colorId: row.color_id,
            condition: row.condition,
            totalQty: row.quantity,
          });
        }
      }

      if (data.length < pageSize) break;
      offset += pageSize;
    }

    const consolidatedLots = lotMap.size;
    const totalItems = Array.from(lotMap.values()).reduce((sum, l) => sum + l.totalQty, 0);

    // Count enriched vs stale consolidated lots
    // A lot is "enriched" if (item_number, color_id) has fresh BL cache for its condition
    const freshAfter = new Date(Date.now() - FRESH_THRESHOLD_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Get fresh cache entries (keyed by part_number|colour_id)
    // We also need to know which conditions have data
    const freshCache = new Map<string, { hasNew: boolean; hasUsed: boolean }>();
    const allPartNumbers = [...new Set(Array.from(lotMap.values()).filter((l) => l.colorId !== null).map((l) => l.itemNumber))];

    for (let i = 0; i < allPartNumbers.length; i += 500) {
      const batch = allPartNumbers.slice(i, i + 500);
      const { data: cached } = await supabase
        .from('bricklink_part_price_cache')
        .select('part_number, colour_id, sell_through_rate_new, sell_through_rate_used')
        .in('part_number', batch)
        .gte('fetched_at', freshAfter);

      if (cached) {
        for (const row of cached) {
          const cacheKey = `${row.part_number}|${row.colour_id}`;
          const existing = freshCache.get(cacheKey) || { hasNew: false, hasUsed: false };
          if (row.sell_through_rate_new !== null) existing.hasNew = true;
          if (row.sell_through_rate_used !== null) existing.hasUsed = true;
          freshCache.set(cacheKey, existing);
        }
      }
    }

    let enrichedLots = 0;
    for (const lot of lotMap.values()) {
      if (lot.colorId === null) continue;
      const cacheKey = `${lot.itemNumber}|${lot.colorId}`;
      const entry = freshCache.get(cacheKey);
      if (!entry) continue;

      const isEnriched = lot.condition === 'New' ? entry.hasNew : entry.hasUsed;
      if (isEnriched) enrichedLots++;
    }

    // Lots with color_id that could be enriched
    const enrichableLots = Array.from(lotMap.values()).filter((l) => l.colorId !== null).length;
    const staleLots = enrichableLots - enrichedLots;

    return NextResponse.json({
      data: {
        syncStatus: meta.sync_status,
        lastFullSync: meta.last_full_sync,
        totalItems,
        totalLots: consolidatedLots,
        syncCursor: meta.sync_cursor,
        syncError: meta.sync_error,
        enrichedLots,
        staleLots,
      },
    });
  } catch (error) {
    console.error('[GET /api/inventory/explorer/sync-status] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { fetchBLCache } from '@/lib/inventory-explorer/bricklink-lookup';

/** 90-day freshness threshold matching enrichment.service.ts */
const FRESH_THRESHOLD_DAYS = 90;

export async function GET() {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

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
      itemType: string;
      condition: string;
      totalQty: number;
    }

    const lotMap = new Map<string, LotInfo>();
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data } = await supabase
        .from('bricqer_inventory_snapshot')
        .select('item_number, color_id, item_type, condition, comment, quantity')
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
            itemType: row.item_type,
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

    // Count enriched vs stale consolidated lots.
    // A lot is "enriched" if its tuple has a fresh UK row in the unified price
    // cache — a capture always writes all four quadrants, so one row covers
    // both conditions (world-fallback data does NOT count as enriched).
    const enrichable = Array.from(lotMap.values()).filter((l) => l.colorId !== null);
    const blCache = await fetchBLCache(supabase, enrichable, {
      ttlDays: FRESH_THRESHOLD_DAYS,
      allowWorldFallback: false,
    });

    let enrichedLots = 0;
    for (const lot of enrichable) {
      const entry = blCache.get(`${lot.itemNumber}|${lot.colorId ?? ''}`);
      if (entry && entry.coverage === 'uk') enrichedLots++;
    }

    const staleLots = enrichable.length - enrichedLots;

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

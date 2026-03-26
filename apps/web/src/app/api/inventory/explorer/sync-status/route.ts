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

    // Count distinct (item_number, color_id) combos in snapshot that have color_id
    // Then check how many have fresh BL cache entries
    const freshAfter = new Date(Date.now() - FRESH_THRESHOLD_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Get all distinct part_number+colour_id from snapshot (paginated)
    const snapshotKeys = new Set<string>();
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data } = await supabase
        .from('bricqer_inventory_snapshot')
        .select('item_number, color_id')
        .eq('user_id', user.id)
        .not('color_id', 'is', null)
        .range(offset, offset + pageSize - 1);

      if (!data || data.length === 0) break;
      for (const row of data) {
        snapshotKeys.add(`${row.item_number}|${row.color_id}`);
      }
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    const totalWithColor = snapshotKeys.size;

    // Get fresh cache entries
    const freshKeys = new Set<string>();
    const partNumbers = [...new Set([...snapshotKeys].map((k) => k.split('|')[0]))];

    for (let i = 0; i < partNumbers.length; i += 500) {
      const batch = partNumbers.slice(i, i + 500);
      const { data: cached } = await supabase
        .from('bricklink_part_price_cache')
        .select('part_number, colour_id')
        .in('part_number', batch)
        .gte('fetched_at', freshAfter);

      if (cached) {
        for (const row of cached) {
          freshKeys.add(`${row.part_number}|${row.colour_id}`);
        }
      }
    }

    // Count matches
    let enrichedLots = 0;
    for (const key of snapshotKeys) {
      if (freshKeys.has(key)) enrichedLots++;
    }

    const staleLots = totalWithColor - enrichedLots;

    return NextResponse.json({
      data: {
        syncStatus: meta.sync_status,
        lastFullSync: meta.last_full_sync,
        totalItems: meta.total_items,
        totalLots: meta.total_lots,
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

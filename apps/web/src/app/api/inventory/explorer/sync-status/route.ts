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
        },
      });
    }

    return NextResponse.json({
      data: {
        syncStatus: meta.sync_status,
        lastFullSync: meta.last_full_sync,
        totalItems: meta.total_items,
        totalLots: meta.total_lots,
        syncCursor: meta.sync_cursor,
        syncError: meta.sync_error,
      },
    });
  } catch (error) {
    console.error('[GET /api/inventory/explorer/sync-status] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

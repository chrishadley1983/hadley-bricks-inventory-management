import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { SnapshotSyncService } from '@/lib/inventory-explorer/snapshot-sync.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = new SnapshotSyncService(supabase, user.id);
    const result = await service.sync();

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[POST /api/inventory/explorer/sync] Error:', error);
    return NextResponse.json(
      { error: 'Failed to sync inventory', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

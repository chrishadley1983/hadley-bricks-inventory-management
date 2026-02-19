import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { InventoryPullService } from '@/lib/minifig-sync/inventory-pull.service';

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

    const service = new InventoryPullService(supabase, user.id);
    const result = await service.pull();

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[POST /api/minifigs/sync/pull-inventory] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to pull inventory',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

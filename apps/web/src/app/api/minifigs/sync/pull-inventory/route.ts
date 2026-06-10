import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { InventoryPullService } from '@/lib/minifig-sync/inventory-pull.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST() {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const service = new InventoryPullService(supabase, user.id);
    const result = await service.pull();

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[POST /api/minifigs/sync/pull-inventory] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to pull inventory',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}

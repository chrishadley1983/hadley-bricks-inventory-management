import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { ShopifySyncService } from '@/lib/shopify';

/**
 * GET /api/shopify-sync — Get sync status overview
 */
export async function GET() {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const service = new ShopifySyncService(supabase, user.id);
    const status = await service.getStatus();

    return NextResponse.json({ data: status });
  } catch (error) {
    console.error('[GET /api/shopify-sync] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

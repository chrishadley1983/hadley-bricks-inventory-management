import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ShopifySyncService } from '@/lib/shopify';

/**
 * GET /api/shopify-sync — Get sync status overview
 */
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

    const service = new ShopifySyncService(supabase, user.id);
    const status = await service.getStatus();

    return NextResponse.json({ data: status });
  } catch (error) {
    console.error('[GET /api/shopify-sync] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

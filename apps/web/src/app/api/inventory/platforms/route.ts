import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { InventoryService } from '@/lib/services';

/**
 * GET /api/inventory/platforms
 * Get distinct listing platforms from inventory
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

    const service = new InventoryService(supabase, user.id);
    const platforms = await service.getDistinctPlatforms();

    return NextResponse.json({ data: platforms });
  } catch (error) {
    console.error('[GET /api/inventory/platforms] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

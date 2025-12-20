import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { InventoryService } from '@/lib/services';

/**
 * GET /api/inventory/summary
 * Get inventory summary statistics
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
    const summary = await service.getSummary();

    return NextResponse.json({ data: summary });
  } catch (error) {
    console.error('[GET /api/inventory/summary] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

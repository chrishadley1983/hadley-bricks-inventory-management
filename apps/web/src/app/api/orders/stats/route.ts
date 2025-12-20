import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { OrderRepository } from '@/lib/repositories';

/**
 * GET /api/orders/stats
 * Get order statistics
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const platform = request.nextUrl.searchParams.get('platform') || undefined;

    const orderRepo = new OrderRepository(supabase);
    const stats = await orderRepo.getStats(user.id, platform);

    return NextResponse.json({ data: stats });
  } catch (error) {
    console.error('[GET /api/orders/stats] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

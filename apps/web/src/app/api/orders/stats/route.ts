import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { OrderRepository } from '@/lib/repositories';

/**
 * GET /api/orders/stats
 * Get order statistics
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const platform = request.nextUrl.searchParams.get('platform') || undefined;

    const orderRepo = new OrderRepository(supabase);
    const stats = await orderRepo.getStats(user.id, platform);

    return NextResponse.json(
      { data: stats },
      {
        headers: {
          'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
        },
      }
    );
  } catch (error) {
    console.error('[GET /api/orders/stats] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

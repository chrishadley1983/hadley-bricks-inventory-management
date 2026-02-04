import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';

/**
 * GET /api/pickups/upcoming
 * Get upcoming pickups for the next 7 days
 */
export async function GET(request: NextRequest) {
  try {
    // Validate auth via API key or session cookie
    const auth = await validateAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service role client for API key auth (bypasses RLS)
    const isApiKeyAuth = !!request.headers.get('x-api-key');
    const supabase = isApiKeyAuth ? createServiceRoleClient() : await createClient();
    const userId = auth.userId;

    const today = new Date();
    const startDate = today.toISOString().split('T')[0];

    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const endDate = nextWeek.toISOString().split('T')[0];

    const { data: pickups, error } = await supabase
      .from('stock_pickups')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'scheduled')
      .gte('scheduled_date', startDate)
      .lte('scheduled_date', endDate)
      .order('scheduled_date', { ascending: true })
      .order('scheduled_time', { ascending: true });

    if (error) {
      console.error('[GET /api/pickups/upcoming] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch upcoming pickups' }, { status: 500 });
    }

    return NextResponse.json({ pickups: pickups || [] });
  } catch (error) {
    console.error('[GET /api/pickups/upcoming] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

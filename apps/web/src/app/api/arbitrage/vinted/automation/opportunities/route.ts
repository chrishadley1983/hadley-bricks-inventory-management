/**
 * Vinted Opportunities API
 *
 * GET - List opportunities with filtering
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  // Check auth
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get query params
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') as
    | 'active'
    | 'purchased'
    | 'expired'
    | 'dismissed'
    | null;
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  // Build query
  let query = supabase
    .from('vinted_opportunities')
    .select('*')
    .eq('user_id', user.id)
    .order('found_at', { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[opportunities] Query error:', error);
    return NextResponse.json({ error: 'Failed to fetch opportunities' }, { status: 500 });
  }

  return NextResponse.json({ opportunities: data });
}

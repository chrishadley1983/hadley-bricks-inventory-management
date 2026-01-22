/**
 * Vinted Scan History API
 *
 * GET - List scan history with filtering
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
  const scanType = searchParams.get('scanType') as 'broad_sweep' | 'watchlist' | null;
  const status = searchParams.get('status') as
    | 'success'
    | 'failed'
    | 'partial'
    | 'captcha'
    | null;
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  // Build query
  let query = supabase
    .from('vinted_scan_log')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (scanType) {
    query = query.eq('scan_type', scanType);
  }

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[history] Query error:', error);
    return NextResponse.json({ error: 'Failed to fetch scan history' }, { status: 500 });
  }

  return NextResponse.json({ scans: data });
}

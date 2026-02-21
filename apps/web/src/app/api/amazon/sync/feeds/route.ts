/**
 * Amazon Sync Feeds API Route
 *
 * GET /api/amazon/sync/feeds - Get feed history
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { AmazonSyncService } from '@/lib/amazon/amazon-sync.service';

// ============================================================================
// SCHEMAS
// ============================================================================

const QuerySchema = z.object({
  limit: z.coerce.number().positive().max(100).optional().default(20),
});

// ============================================================================
// GET - Get feed history
// ============================================================================

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

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = QuerySchema.safeParse(searchParams);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new AmazonSyncService(supabase, user.id);
    const feeds = await service.getFeedHistory(parsed.data.limit);

    return NextResponse.json({ data: { feeds } });
  } catch (error) {
    console.error('[GET /api/amazon/sync/feeds] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Arbitrage Summary API Routes
 *
 * GET /api/arbitrage/summary - Get summary statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { ArbitrageService } from '@/lib/arbitrage';

// ============================================================================
// SCHEMAS
// ============================================================================

const QuerySchema = z.object({
  minMargin: z.coerce.number().min(0).max(100).optional().default(30),
  maxCog: z.coerce.number().min(0).max(100).optional().default(50),
});

// ============================================================================
// GET - Get summary statistics
// ============================================================================

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

    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      minMargin: searchParams.get('minMargin'),
      maxCog: searchParams.get('maxCog'),
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new ArbitrageService(supabase);
    const stats = await service.getSummaryStats(userId, parsed.data.minMargin, parsed.data.maxCog);

    return NextResponse.json({ data: stats });
  } catch (error) {
    console.error('[GET /api/arbitrage/summary] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

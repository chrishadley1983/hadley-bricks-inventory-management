/**
 * Arbitrage Tracker API Routes
 *
 * GET /api/arbitrage - Get arbitrage data with filtering
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { ArbitrageService } from '@/lib/arbitrage';

// ============================================================================
// SCHEMAS
// ============================================================================

const FilterParamsSchema = z.object({
  minMargin: z.coerce.number().min(0).max(100).optional().default(30),
  maxCog: z.coerce.number().min(0).max(100).optional().default(50),
  show: z.enum(['all', 'opportunities', 'ebay_opportunities', 'with_ebay_data', 'no_ebay_data', 'in_stock', 'zero_qty', 'pending_review', 'inventory', 'seeded']).optional().default('all'),
  sortField: z.enum(['margin', 'cog', 'bl_price', 'your_price', 'buy_box', 'was_price', 'sales_rank', 'name', 'ebay_margin', 'ebay_price', 'bl_lots']).optional().default('margin'),
  sortDirection: z.enum(['asc', 'desc']).optional().default('desc'),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().min(10).max(500).optional().default(100),
});

// ============================================================================
// GET - Get arbitrage data
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

    // Parse query parameters - filter out null values so defaults apply
    const { searchParams } = new URL(request.url);
    const params: Record<string, string> = {};
    const minMargin = searchParams.get('minMargin');
    const maxCog = searchParams.get('maxCog');
    const show = searchParams.get('show');
    const sortField = searchParams.get('sortField');
    const sortDirection = searchParams.get('sortDirection');
    const search = searchParams.get('search');
    const page = searchParams.get('page');
    const pageSize = searchParams.get('pageSize');

    if (minMargin) params.minMargin = minMargin;
    if (maxCog) params.maxCog = maxCog;
    if (show) params.show = show;
    if (sortField) params.sortField = sortField;
    if (sortDirection) params.sortDirection = sortDirection;
    if (search) params.search = search;
    if (page) params.page = page;
    if (pageSize) params.pageSize = pageSize;

    const parsed = FilterParamsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new ArbitrageService(supabase);
    const result = await service.getArbitrageData(userId, parsed.data);

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[GET /api/arbitrage] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

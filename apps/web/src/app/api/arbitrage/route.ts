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

export const runtime = 'nodejs';
export const maxDuration = 30;

// ============================================================================
// SCHEMAS
// ============================================================================

const FilterParamsSchema = z.object({
  minMargin: z.coerce.number().min(0).max(100).optional().default(0),
  maxCog: z.coerce.number().min(0).max(100).optional().default(100),
  show: z
    .enum([
      'all',
      'opportunities',
      'ebay_opportunities',
      'with_ebay_data',
      'no_ebay_data',
      'in_stock',
      'zero_qty',
      'pending_review',
      'inventory',
      'seeded',
    ])
    .optional()
    .default('all'),
  sortField: z
    .enum([
      'margin',
      'cog',
      'bl_price',
      'your_price',
      'buy_box',
      'was_price',
      'sales_rank',
      'name',
      'ebay_margin',
      'ebay_price',
      'bl_lots',
    ])
    .optional()
    .default('margin'),
  sortDirection: z.enum(['asc', 'desc']).optional().default('desc'),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().min(10).max(500).optional().default(100),
  // Advanced column filters
  amazonPriceMin: z.coerce.number().min(0).optional(),
  amazonPriceMax: z.coerce.number().min(0).optional(),
  blPriceMin: z.coerce.number().min(0).optional(),
  blPriceMax: z.coerce.number().min(0).optional(),
  marginMin: z.coerce.number().optional(),
  marginMax: z.coerce.number().optional(),
  salesRankMin: z.coerce.number().int().min(0).optional(),
  salesRankMax: z.coerce.number().int().min(0).optional(),
  blLotsMin: z.coerce.number().int().min(0).optional(),
  blLotsMax: z.coerce.number().int().min(0).optional(),
  qtyMin: z.coerce.number().int().min(0).optional(),
  qtyMax: z.coerce.number().int().min(0).optional(),
  source: z.enum(['all', 'inventory', 'seeded']).optional(),
  maxDataAgeDays: z.coerce.number().int().min(1).optional(),
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
    const paramNames = [
      'minMargin', 'maxCog', 'show', 'sortField', 'sortDirection', 'search',
      'page', 'pageSize', 'amazonPriceMin', 'amazonPriceMax', 'blPriceMin',
      'blPriceMax', 'marginMin', 'marginMax', 'salesRankMin', 'salesRankMax',
      'blLotsMin', 'blLotsMax', 'qtyMin', 'qtyMax', 'source', 'maxDataAgeDays',
    ];
    for (const name of paramNames) {
      const value = searchParams.get(name);
      if (value) params[name] = value;
    }

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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

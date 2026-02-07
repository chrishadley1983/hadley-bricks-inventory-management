/**
 * GET /api/investment
 *
 * Returns investment-tracked LEGO sets with retirement data and Amazon pricing.
 * Supports filtering by retirement status, theme, year range, and "retiring within" timeframe.
 * Server-side pagination.
 *
 * Amazon pricing data is joined from amazon_arbitrage_pricing via the set's amazon_asin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { z } from 'zod';

const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  retirementStatus: z.enum(['available', 'retiring_soon', 'retired']).optional(),
  theme: z.string().optional(),
  minYear: z.coerce.number().optional(),
  maxYear: z.coerce.number().optional(),
  retiringWithinMonths: z.coerce.number().min(1).max(36).optional(),
  sortBy: z.string().default('year_from'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export async function GET(request: NextRequest) {
  try {
    const queryParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = QuerySchema.safeParse(queryParams);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      page,
      pageSize,
      search,
      retirementStatus,
      theme,
      minYear,
      maxYear,
      retiringWithinMonths,
      sortBy,
      sortOrder,
    } = parsed.data;

    const supabase = createServiceRoleClient();

    // Build query - include amazon_asin for pricing lookup
    // Note: Some columns (retirement_status, amazon_asin, etc.) are added by investment
    // migrations and may not be in generated types yet. Using raw select string.
    let query = supabase
      .from('brickset_sets')
      .select(
        'id, set_number, set_name, theme, subtheme, year_from, pieces, minifigs, uk_retail_price, retirement_status, expected_retirement_date, retirement_confidence, exclusivity_tier, is_licensed, is_ucs, is_modular, image_url, availability, amazon_asin, has_amazon_listing, classification_override',
        { count: 'exact' }
      );

    // Apply filters
    if (search) {
      query = query.or(
        `set_number.ilike.%${search}%,set_name.ilike.%${search}%`
      );
    }

    if (retirementStatus) {
      query = query.eq('retirement_status' as string, retirementStatus);
    }

    if (theme) {
      query = query.ilike('theme', `%${theme}%`);
    }

    if (minYear) {
      query = query.gte('year_from', minYear);
    }

    if (maxYear) {
      query = query.lte('year_from', maxYear);
    }

    if (retiringWithinMonths) {
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() + retiringWithinMonths);
      const today = new Date().toISOString().split('T')[0];
      const cutoff = cutoffDate.toISOString().split('T')[0];

      query = query
        .gte('expected_retirement_date' as string, today)
        .lte('expected_retirement_date' as string, cutoff);
    }

    // Apply sorting
    const ascending = sortOrder === 'asc';
    query = query.order(sortBy, { ascending, nullsFirst: false });

    // Apply pagination
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.error('[GET /api/investment] Query error:', error.message);
      return NextResponse.json(
        { error: 'Database query failed' },
        { status: 500 }
      );
    }

    // Cast since generated types may not include all investment columns yet
    const sets = (data ?? []) as unknown as Record<string, unknown>[];

    // Enrich with Amazon pricing data for sets that have ASINs
    const asinsToLookup = sets
      .filter((s) => s.amazon_asin)
      .map((s) => s.amazon_asin as string);

    const pricingMap = new Map<string, {
      buy_box_price: number | null;
      was_price_90d: number | null;
      sales_rank: number | null;
      offer_count: number | null;
      snapshot_date: string | null;
    }>();

    if (asinsToLookup.length > 0) {
      // Batch query: get latest pricing snapshot for each ASIN
      // Using individual queries with LIMIT 1 per ASIN
      const uniqueAsins = [...new Set(asinsToLookup)];

      // Fetch in parallel batches of 10
      const batchSize = 10;
      for (let i = 0; i < uniqueAsins.length; i += batchSize) {
        const batch = uniqueAsins.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map((asin) =>
            supabase
              .from('amazon_arbitrage_pricing')
              .select('asin, buy_box_price, was_price_90d, sales_rank, offer_count, snapshot_date')
              .eq('asin', asin)
              .order('snapshot_date', { ascending: false })
              .limit(1)
              .single()
          )
        );

        for (const result of results) {
          if (result.data) {
            const snap = result.data as Record<string, unknown>;
            pricingMap.set(snap.asin as string, {
              buy_box_price: snap.buy_box_price as number | null,
              was_price_90d: snap.was_price_90d as number | null,
              sales_rank: snap.sales_rank as number | null,
              offer_count: snap.offer_count as number | null,
              snapshot_date: snap.snapshot_date as string | null,
            });
          }
        }
      }
    }

    // Merge pricing into response
    const enrichedSets = sets.map((set) => {
      const asin = set.amazon_asin as string | null;
      const pricing = asin ? pricingMap.get(asin) : null;
      return {
        ...set,
        buy_box_price: pricing?.buy_box_price ?? null,
        was_price: pricing?.was_price_90d ?? null,
        sales_rank: pricing?.sales_rank ?? null,
        offer_count: pricing?.offer_count ?? null,
        latest_snapshot_date: pricing?.snapshot_date ?? null,
      };
    });

    const total = count ?? 0;
    const totalPages = Math.ceil(total / pageSize);

    return NextResponse.json({
      data: enrichedSets,
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (error) {
    console.error('[GET /api/investment] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

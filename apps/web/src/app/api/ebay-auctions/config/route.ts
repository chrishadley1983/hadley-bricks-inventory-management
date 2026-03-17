/**
 * GET/PUT /api/ebay-auctions/config
 *
 * Manage eBay Auction Sniper configuration.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const configUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  minMarginPercent: z.number().min(0).max(100).optional(),
  greatMarginPercent: z.number().min(0).max(100).optional(),
  minProfitGbp: z.number().min(0).optional(),
  maxBidPriceGbp: z.number().min(0).nullable().optional(),
  defaultPostageGbp: z.number().min(0).max(50).optional(),
  quietHoursEnabled: z.boolean().optional(),
  quietHoursStart: z.number().int().min(0).max(23).optional(),
  quietHoursEnd: z.number().int().min(0).max(23).optional(),
  excludedSets: z.array(z.string().regex(/^\d{4,6}$/)).optional(),
  scanWindowMinutes: z.number().int().min(5).max(60).optional(),
  minBids: z.number().int().min(0).optional(),
  maxSalesRank: z.number().int().min(0).nullable().optional(),
  joblotAnalysisEnabled: z.boolean().optional(),
  joblotMinTotalValueGbp: z.number().min(0).optional(),
});

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('ebay_auction_config')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Validate input
    const parsed = configUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid config', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // Map camelCase to snake_case for DB
    const fieldMap: Record<string, string> = {
      enabled: 'enabled',
      minMarginPercent: 'min_margin_percent',
      greatMarginPercent: 'great_margin_percent',
      minProfitGbp: 'min_profit_gbp',
      maxBidPriceGbp: 'max_bid_price_gbp',
      defaultPostageGbp: 'default_postage_gbp',
      quietHoursEnabled: 'quiet_hours_enabled',
      quietHoursStart: 'quiet_hours_start',
      quietHoursEnd: 'quiet_hours_end',
      excludedSets: 'excluded_sets',
      scanWindowMinutes: 'scan_window_minutes',
      minBids: 'min_bids',
      maxSalesRank: 'max_sales_rank',
      joblotAnalysisEnabled: 'joblot_analysis_enabled',
      joblotMinTotalValueGbp: 'joblot_min_total_value_gbp',
    };

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    for (const [clientKey, dbKey] of Object.entries(fieldMap)) {
      if (clientKey in parsed.data) {
        update[dbKey] = (parsed.data as Record<string, unknown>)[clientKey];
      }
    }

    const { data, error } = await supabase
      .from('ebay_auction_config')
      .update(update)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

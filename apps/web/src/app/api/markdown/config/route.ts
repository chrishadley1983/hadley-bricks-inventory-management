import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { z } from 'zod';

const configUpdateSchema = z.object({
  mode: z.enum(['review', 'auto']).optional(),
  amazon_step1_days: z.number().int().min(1).optional(),
  amazon_step2_days: z.number().int().min(1).optional(),
  amazon_step3_days: z.number().int().min(1).optional(),
  amazon_step4_days: z.number().int().min(1).optional(),
  amazon_step2_undercut_pct: z.number().min(0).max(50).optional(),
  amazon_step3_undercut_pct: z.number().min(0).max(50).optional(),
  ebay_step1_days: z.number().int().min(1).optional(),
  ebay_step2_days: z.number().int().min(1).optional(),
  ebay_step3_days: z.number().int().min(1).optional(),
  ebay_step4_days: z.number().int().min(1).optional(),
  ebay_step1_reduction_pct: z.number().min(0).max(50).optional(),
  ebay_step2_reduction_pct: z.number().min(0).max(50).optional(),
  overpriced_threshold_pct: z.number().min(1).max(50).optional(),
  low_demand_sales_rank: z.number().int().min(1000).optional(),
  auction_default_duration_days: z.number().int().min(1).max(10).optional(),
  auction_max_per_day: z.number().int().min(1).max(10).optional(),
  auction_enabled: z.boolean().optional(),
  suggest_interval_days: z.number().int().min(1).max(180).optional(),
  relist_age_days: z.number().int().min(1).max(365).optional(),
  min_change_pct: z.number().min(0).max(50).optional(),
  report_email: z.string().email().nullable().optional(),
  amazon_postage_cost: z.number().min(0).max(20).optional(),
  ebay_postage_cost: z.number().min(0).max(20).optional(),
  amazon_persistence_window_days: z.number().int().min(3).max(60).optional(),
  amazon_persistence_min_pct: z.number().min(50).max(100).optional(),
  amazon_reference_window_days: z.number().int().min(30).max(365).optional(),
  amazon_decay_start_days: z.number().int().min(30).max(365).optional(),
  amazon_decay_interval_days: z.number().int().min(14).max(180).optional(),
  amazon_decay_step_pct: z.number().min(1).max(25).optional(),
  amazon_decay_floor_pct: z.number().min(30).max(95).optional(),
  amazon_exit_days: z.number().int().min(90).max(1000).optional(),
  amazon_min_drops_90d: z.number().int().min(0).max(100).optional(),
  amazon_healthy_drops_90d: z.number().int().min(1).max(1000).optional(),
});

export async function GET() {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase deep type inference workaround
    const { data, error } = await (supabase as any)
      .from('markdown_config')
      .select('id, user_id, mode, amazon_step1_days, amazon_step2_days, amazon_step3_days, amazon_step4_days, amazon_step2_undercut_pct, amazon_step3_undercut_pct, ebay_step1_days, ebay_step2_days, ebay_step3_days, ebay_step4_days, ebay_step1_reduction_pct, ebay_step2_reduction_pct, amazon_fee_rate, ebay_fee_rate, overpriced_threshold_pct, low_demand_sales_rank, auction_default_duration_days, auction_max_per_day, auction_enabled, suggest_interval_days, relist_age_days, min_change_pct, report_email, amazon_postage_cost, ebay_postage_cost, amazon_persistence_window_days, amazon_persistence_min_pct, amazon_reference_window_days, amazon_decay_start_days, amazon_decay_interval_days, amazon_decay_step_pct, amazon_decay_floor_pct, amazon_exit_days, amazon_min_drops_90d, amazon_healthy_drops_90d, created_at, updated_at')
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
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const parsed = configUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid config', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) {
        update[key] = value;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('markdown_config')
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

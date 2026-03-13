import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { z } from 'zod';

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

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
});

export async function GET() {
  try {
    const supabase = createServiceRoleClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase deep type inference workaround
    const { data, error } = await (supabase as any)
      .from('markdown_config')
      .select('id, user_id, mode, amazon_step1_days, amazon_step2_days, amazon_step3_days, amazon_step4_days, amazon_step2_undercut_pct, amazon_step3_undercut_pct, ebay_step1_days, ebay_step2_days, ebay_step3_days, ebay_step4_days, ebay_step1_reduction_pct, ebay_step2_reduction_pct, amazon_fee_rate, ebay_fee_rate, overpriced_threshold_pct, low_demand_sales_rank, auction_default_duration_days, auction_max_per_day, auction_enabled, created_at, updated_at')
      .eq('user_id', DEFAULT_USER_ID)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = configUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid config', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const supabase = createServiceRoleClient();

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
      .eq('user_id', DEFAULT_USER_ID)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

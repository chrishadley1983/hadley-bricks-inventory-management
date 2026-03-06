import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const UpdateConfigSchema = z.object({
  sync_enabled: z.boolean().optional(),
  auto_sync_new_listings: z.boolean().optional(),
  default_discount_pct: z.number().min(0).max(50).optional(),
  location_id: z.string().optional(),
});

/**
 * GET /api/shopify-sync/config — Get Shopify sync configuration
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('shopify_config')
      .select(
        'id, shop_domain, api_version, location_id, sync_enabled, auto_sync_new_listings, default_discount_pct, created_at, updated_at'
      )
      .eq('user_id', user.id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Shopify not configured' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('[GET /api/shopify-sync/config] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/shopify-sync/config — Update sync settings
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = UpdateConfigSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('shopify_config')
      .update(parsed.data)
      .eq('user_id', user.id)
      .select(
        'id, shop_domain, api_version, location_id, sync_enabled, auto_sync_new_listings, default_discount_pct, updated_at'
      )
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Failed to update config' }, { status: 422 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('[PATCH /api/shopify-sync/config] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

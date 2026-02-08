import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const UpdateConfigSchema = z.object({
  target_ebay_listings: z.number().nullable().optional(),
  target_amazon_listings: z.number().nullable().optional(),
  target_bricklink_weekly_value: z.number().nullable().optional(),
  target_daily_listed_value: z.number().nullable().optional(),
  target_daily_sold_value: z.number().nullable().optional(),
  pomodoro_daily_target: z.number().nullable().optional(),
  pomodoro_classic_work: z.number().min(1).max(120).nullable().optional(),
  pomodoro_classic_break: z.number().min(1).max(60).nullable().optional(),
  pomodoro_long_work: z.number().min(1).max(120).nullable().optional(),
  pomodoro_long_break: z.number().min(1).max(60).nullable().optional(),
  pomodoro_sessions_before_long_break: z.number().min(1).max(10).nullable().optional(),
  time_categories: z.array(z.object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    icon: z.string().optional(),
    isDefault: z.boolean().optional(),
  })).nullable().optional(),
  working_days: z.number().min(1).max(7).nullable().optional(),
  notifications_enabled: z.boolean().nullable().optional(),
  notification_dispatch_hours: z.number().nullable().optional(),
  notification_overdue_orders: z.boolean().nullable().optional(),
  notification_sync_failure: z.boolean().nullable().optional(),
  notification_resolution_threshold: z.number().nullable().optional(),
  audio_enabled: z.boolean().nullable().optional(),
  audio_work_complete: z.string().nullable().optional(),
  audio_break_complete: z.string().nullable().optional(),
});

/**
 * GET /api/workflow/config
 * Get workflow configuration for current user
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

    // Try to get existing config
    const { data: existingConfig, error } = await supabase
      .from('workflow_config')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 is "no rows returned", which is expected for new users
      console.error('[GET /api/workflow/config] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
    }

    // If config exists, return it
    if (existingConfig) {
      return NextResponse.json({ config: existingConfig });
    }

    // No config exists - create default config
    const defaultConfig = {
      user_id: user.id,
      target_ebay_listings: 735,
      target_amazon_listings: 1050,
      target_bricklink_weekly_value: 500,
      target_daily_listed_value: 200,
      target_daily_sold_value: 150,
      pomodoro_daily_target: 4,
      pomodoro_classic_work: 25,
      pomodoro_classic_break: 5,
      pomodoro_long_work: 50,
      pomodoro_long_break: 10,
      pomodoro_sessions_before_long_break: 4,
      working_days: 7,
      notifications_enabled: true,
      notification_dispatch_hours: 24,
      notification_overdue_orders: true,
      notification_sync_failure: true,
      notification_resolution_threshold: 10,
      audio_enabled: true,
      time_categories: [
        { id: 'sourcing', name: 'Sourcing', color: '#3B82F6', isDefault: true },
        { id: 'listing', name: 'Listing', color: '#10B981', isDefault: true },
        { id: 'shipping', name: 'Shipping', color: '#F59E0B', isDefault: true },
        { id: 'admin', name: 'Admin', color: '#8B5CF6', isDefault: true },
        { id: 'sorting', name: 'Sorting', color: '#EC4899', isDefault: true },
        { id: 'other', name: 'Other', color: '#6B7280', isDefault: true },
      ],
    };

    const { data: newConfig, error: insertError } = await supabase
      .from('workflow_config')
      .insert(defaultConfig)
      .select()
      .single();

    if (insertError) {
      console.error('[GET /api/workflow/config] Insert error:', insertError);
      return NextResponse.json({ error: 'Failed to create config' }, { status: 500 });
    }

    return NextResponse.json({ config: newConfig });
  } catch (error) {
    console.error('[GET /api/workflow/config] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/workflow/config
 * Update workflow configuration
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

    // Check if config exists
    const { data: existing } = await supabase
      .from('workflow_config')
      .select('id')
      .eq('user_id', user.id)
      .single();

    let config;

    if (existing) {
      // Update existing config
      const { data, error } = await supabase
        .from('workflow_config')
        .update({
          ...parsed.data,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) {
        console.error('[PATCH /api/workflow/config] Update error:', error);
        return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
      }

      config = data;
    } else {
      // Create new config with provided values
      const { data, error } = await supabase
        .from('workflow_config')
        .insert({
          user_id: user.id,
          ...parsed.data,
        })
        .select()
        .single();

      if (error) {
        console.error('[PATCH /api/workflow/config] Insert error:', error);
        return NextResponse.json({ error: 'Failed to create config' }, { status: 500 });
      }

      config = data;
    }

    return NextResponse.json({ config });
  } catch (error) {
    console.error('[PATCH /api/workflow/config] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

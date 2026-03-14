import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const StageSchema = z.object({
  days_threshold: z.number().int().min(0),
  bid_percentage: z.number().min(2.0).max(100.0),
});

const SaveScheduleSchema = z.object({
  campaignId: z.string().min(1),
  campaignName: z.string().optional(),
  enabled: z.boolean(),
  stages: z.array(StageSchema).min(1, 'At least one stage is required'),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

/**
 * GET /api/integrations/ebay/promoted-listings/schedules
 * Fetch all promotion schedules with their stages
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

    const db = supabase as AnySupabase;
    const { data: schedules, error } = await db
      .from('ebay_promoted_listings_schedules')
      .select('*, ebay_promoted_listings_stages(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /schedules] Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Reshape to include stages sorted by days_threshold
    const shaped = (schedules || []).map((s: Record<string, unknown>) => ({
      id: s.id,
      campaign_id: s.campaign_id,
      campaign_name: s.campaign_name,
      enabled: s.enabled,
      created_at: s.created_at,
      updated_at: s.updated_at,
      stages: (
        (s.ebay_promoted_listings_stages as Array<{
          id: string;
          days_threshold: number;
          bid_percentage: number;
        }>) || []
      ).sort((a, b) => a.days_threshold - b.days_threshold),
    }));

    return NextResponse.json({ schedules: shaped });
  } catch (error) {
    console.error('[GET /schedules] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/integrations/ebay/promoted-listings/schedules
 * Create or update a promotion schedule with stages
 */
export async function POST(request: NextRequest) {
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
    const parsed = SaveScheduleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { campaignId, campaignName, enabled, stages } = parsed.data;
    const db = supabase as AnySupabase;

    // Upsert the schedule
    const { data: schedule, error: scheduleError } = await db
      .from('ebay_promoted_listings_schedules')
      .upsert(
        {
          user_id: user.id,
          campaign_id: campaignId,
          campaign_name: campaignName || null,
          enabled,
        },
        { onConflict: 'user_id,campaign_id' }
      )
      .select()
      .single();

    if (scheduleError || !schedule) {
      console.error('[POST /schedules] Upsert error:', scheduleError);
      return NextResponse.json(
        { error: scheduleError?.message || 'Failed to save schedule' },
        { status: 500 }
      );
    }

    // Delete existing stages and re-insert
    await db
      .from('ebay_promoted_listings_stages')
      .delete()
      .eq('schedule_id', schedule.id);

    const { error: stagesError } = await db
      .from('ebay_promoted_listings_stages')
      .insert(
        stages.map((s) => ({
          schedule_id: schedule.id,
          days_threshold: s.days_threshold,
          bid_percentage: s.bid_percentage,
        }))
      );

    if (stagesError) {
      console.error('[POST /schedules] Stages insert error:', stagesError);
      return NextResponse.json({ error: stagesError.message }, { status: 500 });
    }

    // Fetch the complete schedule with stages
    const { data: complete } = await db
      .from('ebay_promoted_listings_schedules')
      .select('*, ebay_promoted_listings_stages(*)')
      .eq('id', schedule.id)
      .single();

    return NextResponse.json({ schedule: complete });
  } catch (error) {
    console.error('[POST /schedules] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/integrations/ebay/promoted-listings/schedules?id=xxx
 * Delete a promotion schedule and its stages
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const scheduleId = request.nextUrl.searchParams.get('id');
    if (!scheduleId) {
      return NextResponse.json({ error: 'Schedule ID required' }, { status: 400 });
    }

    const db = supabase as AnySupabase;
    const { error } = await db
      .from('ebay_promoted_listings_schedules')
      .delete()
      .eq('id', scheduleId)
      .eq('user_id', user.id);

    if (error) {
      console.error('[DELETE /schedules] Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /schedules] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

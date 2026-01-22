/**
 * Vinted Scanner Automation Config API
 *
 * GET - Get scanner configuration
 * PUT - Update scanner configuration
 * POST - Pause/resume scanner
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

// =============================================================================
// SCHEMAS
// =============================================================================

const UpdateConfigSchema = z.object({
  enabled: z.boolean().optional(),
  broad_sweep_cog_threshold: z.number().int().min(10).max(80).optional(),
  watchlist_cog_threshold: z.number().int().min(10).max(80).optional(),
  near_miss_threshold: z.number().int().min(20).max(90).optional(),
  operating_hours_start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  operating_hours_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

const PauseResumeSchema = z.object({
  action: z.enum(['pause', 'resume']),
  reason: z.string().max(200).optional(),
});

// =============================================================================
// GET - Get scanner configuration
// =============================================================================

export async function GET() {
  const supabase = await createClient();

  // Check auth
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get or create config
    const { data: configData, error } = await supabase
      .from('vinted_scanner_config')
      .select('*')
      .eq('user_id', user.id)
      .single();

    let config = configData;

    if (error && error.code === 'PGRST116') {
      // No config exists, create default
      const { data: newConfig, error: insertError } = await supabase
        .from('vinted_scanner_config')
        .insert({ user_id: user.id })
        .select()
        .single();

      if (insertError) {
        console.error('[automation] Failed to create config:', insertError);
        return NextResponse.json(
          { error: 'Failed to create configuration' },
          { status: 500 }
        );
      }

      config = newConfig;
    } else if (error) {
      console.error('[automation] Failed to fetch config:', error);
      return NextResponse.json(
        { error: 'Failed to fetch configuration' },
        { status: 500 }
      );
    }

    // Get today's scan stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: scanLogs, error: logsError } = await supabase
      .from('vinted_scan_log')
      .select('scan_type, status, listings_found, opportunities_found')
      .eq('user_id', user.id)
      .gte('created_at', today.toISOString());

    const todayStats = {
      broadSweeps: 0,
      watchlistScans: 0,
      listings: 0,
      opportunities: 0,
      captchas: 0,
    };

    if (!logsError && scanLogs) {
      for (const log of scanLogs) {
        if (log.scan_type === 'broad_sweep') {
          todayStats.broadSweeps++;
        } else if (log.scan_type === 'watchlist') {
          todayStats.watchlistScans++;
        }
        todayStats.listings += log.listings_found || 0;
        todayStats.opportunities += log.opportunities_found || 0;
        if (log.status === 'captcha') {
          todayStats.captchas++;
        }
      }
    }

    // Get last scan time
    const { data: lastScan } = await supabase
      .from('vinted_scan_log')
      .select('id, created_at, scan_type, status, listings_found, completed_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      config,
      todayStats,
      lastScan: lastScan || null,
    });
  } catch (error) {
    console.error('[automation] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// =============================================================================
// PUT - Update scanner configuration
// =============================================================================

export async function PUT(request: NextRequest) {
  const supabase = await createClient();

  // Check auth
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse request body
  const body = await request.json();
  const parsed = UpdateConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const { data: config, error } = await supabase
      .from('vinted_scanner_config')
      .update({
        ...parsed.data,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      console.error('[automation] Failed to update config:', error);
      return NextResponse.json(
        { error: 'Failed to update configuration' },
        { status: 500 }
      );
    }

    return NextResponse.json({ config });
  } catch (error) {
    console.error('[automation] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST - Pause/resume scanner
// =============================================================================

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Check auth
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse request body
  const body = await request.json();
  const parsed = PauseResumeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { action, reason } = parsed.data;

  try {
    const updateData =
      action === 'pause'
        ? {
            paused: true,
            pause_reason: reason || 'Manual pause',
            updated_at: new Date().toISOString(),
          }
        : {
            paused: false,
            pause_reason: null,
            consecutive_failures: 0, // Reset on resume
            updated_at: new Date().toISOString(),
          };

    const { data: config, error } = await supabase
      .from('vinted_scanner_config')
      .update(updateData)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      console.error(`[automation] Failed to ${action} scanner:`, error);
      return NextResponse.json(
        { error: `Failed to ${action} scanner` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      action,
      config,
    });
  } catch (error) {
    console.error('[automation] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

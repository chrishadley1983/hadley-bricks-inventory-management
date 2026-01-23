/**
 * API Route: /api/home-costs/settings
 * PATCH - Update display mode setting
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * Zod schema for updating settings
 */
const UpdateSettingsSchema = z.object({
  displayMode: z.enum(['separate', 'consolidated']),
});

/**
 * PATCH /api/home-costs/settings
 * Updates the display mode setting
 * F10: Returns 200 with updated settings
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
    const parsed = UpdateSettingsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Upsert settings (insert or update)
    const { data: settings, error: upsertError } = await supabase
      .from('home_costs_settings')
      .upsert(
        {
          user_id: user.id,
          display_mode: parsed.data.displayMode,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (upsertError) {
      console.error('[PATCH /api/home-costs/settings] Upsert error:', upsertError);
      throw upsertError;
    }

    return NextResponse.json({
      data: { displayMode: settings.display_mode },
    });
  } catch (error) {
    console.error('[PATCH /api/home-costs/settings] Error:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}

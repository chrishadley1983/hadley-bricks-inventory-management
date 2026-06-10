/**
 * Settings API Routes
 *
 * GET   /api/listing-assistant/settings - Get user settings
 * PATCH /api/listing-assistant/settings - Update user settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';
import { getSettings, updateSettings } from '@/lib/listing-assistant/settings.service';

const UpdateSettingsSchema = z.object({
  default_tone: z
    .enum(['Standard', 'Professional', 'Enthusiastic', 'Friendly', 'Minimalist'])
    .optional(),
  default_condition: z.enum(['New', 'Used']).optional(),
});

/**
 * GET /api/listing-assistant/settings
 */
export async function GET() {
  try {
    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const settings = await getSettings(user.id);

    return NextResponse.json({ data: settings });
  } catch (error) {
    console.error('[GET /api/listing-assistant/settings] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/listing-assistant/settings
 */
export async function PATCH(request: NextRequest) {
  try {
    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const parsed = UpdateSettingsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const settings = await updateSettings(user.id, parsed.data);

    return NextResponse.json({ data: settings });
  } catch (error) {
    console.error('[PATCH /api/listing-assistant/settings] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

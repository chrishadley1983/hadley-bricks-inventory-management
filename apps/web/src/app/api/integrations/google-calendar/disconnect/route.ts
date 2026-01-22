import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { googleCalendarAuthService } from '@/lib/google-calendar';

/**
 * POST /api/integrations/google-calendar/disconnect
 * Disconnect Google Calendar by removing stored credentials
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await googleCalendarAuthService.disconnect(user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/integrations/google-calendar/disconnect] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

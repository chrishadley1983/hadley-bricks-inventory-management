import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { googleCalendarAuthService } from '@/lib/google-calendar';

/**
 * GET /api/integrations/google-calendar/status
 * Get the Google Calendar connection status for the current user
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

    const status = await googleCalendarAuthService.getConnectionStatus(user.id);

    return NextResponse.json(status);
  } catch (error) {
    console.error('[GET /api/integrations/google-calendar/status] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

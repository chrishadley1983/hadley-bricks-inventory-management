import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { googleCalendarAuthService } from '@/lib/google-calendar';

/**
 * POST /api/integrations/google-calendar/disconnect
 * Disconnect Google Calendar by removing stored credentials
 */
export async function POST() {
  try {
    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    await googleCalendarAuthService.disconnect(user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/integrations/google-calendar/disconnect] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

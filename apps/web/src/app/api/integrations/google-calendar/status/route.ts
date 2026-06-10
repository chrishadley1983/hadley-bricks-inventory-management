import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { googleCalendarAuthService } from '@/lib/google-calendar';

/**
 * GET /api/integrations/google-calendar/status
 * Get the Google Calendar connection status for the current user
 */
export async function GET() {
  try {
    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const status = await googleCalendarAuthService.getConnectionStatus(user.id);

    return NextResponse.json(status);
  } catch (error) {
    console.error('[GET /api/integrations/google-calendar/status] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

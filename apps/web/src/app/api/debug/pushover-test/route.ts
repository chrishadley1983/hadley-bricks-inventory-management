import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { pushoverService } from '@/lib/notifications';

/**
 * GET /api/debug/pushover-test
 * Send a test push notification
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

    if (!pushoverService.isEnabled()) {
      return NextResponse.json({
        error: 'Pushover not configured',
        details: 'Missing PUSHOVER_USER_KEY or PUSHOVER_API_TOKEN'
      }, { status: 400 });
    }

    const result = await pushoverService.send({
      title: '🧪 Test Notification',
      message: 'Hadley Bricks production deployment is working!\n\nThis is a test notification from your inventory system.',
      priority: 0,
      sound: 'pushover',
    });

    return NextResponse.json({
      success: result.success,
      error: result.error,
      message: result.success ? 'Test notification sent!' : 'Failed to send notification'
    });
  } catch (error) {
    console.error('[GET /api/debug/pushover-test] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

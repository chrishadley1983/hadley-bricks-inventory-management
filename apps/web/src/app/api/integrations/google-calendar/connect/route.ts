import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { googleCalendarAuthService } from '@/lib/google-calendar';

const ConnectSchema = z.object({
  returnUrl: z
    .string()
    .refine(
      (val) => val.startsWith('/') || val.startsWith('http://') || val.startsWith('https://'),
      {
        message: 'Must be a valid URL or relative path starting with /',
      }
    )
    .optional(),
});

/**
 * GET /api/integrations/google-calendar/connect
 * Initiate Google Calendar OAuth flow by redirecting to Google authorization page
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const returnUrl = searchParams.get('returnUrl') || undefined;

    // Validate parameters
    const parsed = ConnectSchema.safeParse({ returnUrl });
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Generate authorization URL
    const authUrl = googleCalendarAuthService.getAuthorizationUrl(user.id, parsed.data.returnUrl);

    // Redirect to Google authorization
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('[GET /api/integrations/google-calendar/connect] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/integrations/google-calendar/connect
 * Get the authorization URL without redirecting (for client-side navigation)
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
    const parsed = ConnectSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const authUrl = googleCalendarAuthService.getAuthorizationUrl(user.id, parsed.data.returnUrl);

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error('[POST /api/integrations/google-calendar/connect] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

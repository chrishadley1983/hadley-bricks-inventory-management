import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Validates request authentication via either:
 * 1. API key header (x-api-key) for server-to-server calls
 * 2. Supabase session cookie for browser calls
 *
 * Returns user ID if authenticated, null otherwise.
 */
export async function validateAuth(request: NextRequest): Promise<{ userId: string } | null> {
  // Check for API key auth first
  const apiKey = request.headers.get('x-api-key');
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (apiKey && expectedKey && apiKey === expectedKey) {
    // API key auth - use the configured service user ID
    const serviceUserId = process.env.SERVICE_USER_ID;
    if (serviceUserId) {
      return { userId: serviceUserId };
    }
    console.warn('[validateAuth] API key valid but SERVICE_USER_ID not configured');
  }

  // Fall back to cookie-based auth
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return { userId: user.id };
}

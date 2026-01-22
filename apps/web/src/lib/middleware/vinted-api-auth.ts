/**
 * Vinted Automation API Authentication Middleware
 *
 * Validates X-Api-Key header for Windows tray app requests.
 * AUTH1: All /automation/* endpoints validate X-Api-Key header
 * AUTH4: Invalid API key returns 401
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Result of API key validation
 */
export interface ApiKeyValidationResult {
  valid: boolean;
  userId?: string;
  error?: string;
}

/**
 * Validate X-Api-Key header against stored user API key
 *
 * @param request - Next.js request
 * @returns Validation result with user ID if valid
 */
export async function validateApiKey(request: NextRequest): Promise<ApiKeyValidationResult> {
  const apiKey = request.headers.get('X-Api-Key');

  if (!apiKey) {
    return { valid: false, error: 'Missing X-Api-Key header' };
  }

  try {
    const supabase = await createClient();

    // Look up the API key in scanner config
    const { data: config, error } = await supabase
      .from('vinted_scanner_config')
      .select('user_id, api_key')
      .eq('api_key', apiKey)
      .single();

    if (error || !config) {
      return { valid: false, error: 'Invalid API key' };
    }

    return { valid: true, userId: config.user_id };
  } catch (err) {
    console.error('[validateApiKey] Error:', err);
    return { valid: false, error: 'API key validation failed' };
  }
}

/**
 * Helper to return 401 response for invalid API key
 */
export function unauthorizedResponse(message: string = 'Unauthorized'): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

/**
 * Wrapper for API routes that require API key authentication
 * Use this for machine-to-machine API endpoints
 *
 * @example
 * export async function GET(request: NextRequest) {
 *   return withApiKeyAuth(request, async (userId) => {
 *     // Your handler code here
 *     return NextResponse.json({ data: 'example' });
 *   });
 * }
 */
export async function withApiKeyAuth<T>(
  request: NextRequest,
  handler: (userId: string) => Promise<NextResponse<T | { error: string }>>
): Promise<NextResponse<T | { error: string }>> {
  const validation = await validateApiKey(request);

  if (!validation.valid) {
    return NextResponse.json({ error: validation.error || 'Unauthorized' }, { status: 401 });
  }

  return handler(validation.userId!);
}

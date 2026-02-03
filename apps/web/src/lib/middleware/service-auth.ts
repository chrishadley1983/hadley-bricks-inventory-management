/**
 * Service API Authentication Middleware
 *
 * Validates x-api-key header for service-to-service requests (Peter, automations).
 * Keys are hashed with SHA-256 and validated against service_api_keys table.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Result of service API key validation
 */
export interface ServiceKeyValidationResult {
  valid: boolean;
  keyId?: string;
  keyName?: string;
  permissions?: string[];
  error?: string;
}

/**
 * Validate x-api-key header against service_api_keys table
 *
 * @param request - Next.js request
 * @param requiredPermissions - Array of required permission strings
 * @returns Validation result with key details if valid
 */
export async function validateServiceKey(
  request: NextRequest,
  requiredPermissions: string[] = ['read']
): Promise<ServiceKeyValidationResult> {
  const apiKey = request.headers.get('x-api-key');

  if (!apiKey) {
    return { valid: false, error: 'Missing x-api-key header' };
  }

  if (!apiKey.startsWith('hb_sk_')) {
    return { valid: false, error: 'Invalid key format' };
  }

  try {
    // Hash the key for comparison
    const keyHash = createHash('sha256').update(apiKey).digest('hex');

    // Use service role client to bypass RLS
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase
      .from('service_api_keys')
      .select('id, name, permissions, expires_at, revoked_at')
      .eq('key_hash', keyHash)
      .single();

    if (error || !data) {
      return { valid: false, error: 'Invalid API key' };
    }

    // Check if revoked
    if (data.revoked_at) {
      return { valid: false, error: 'API key has been revoked' };
    }

    // Check if expired
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return { valid: false, error: 'API key has expired' };
    }

    // Check permissions
    const permissions = (data.permissions as string[]) || [];
    const hasPermissions = requiredPermissions.every(p => permissions.includes(p));

    if (!hasPermissions) {
      return {
        valid: false,
        error: `Missing required permissions: ${requiredPermissions.join(', ')}`,
      };
    }

    // Update last_used_at (fire and forget - don't block the request)
    supabase
      .from('service_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id)
      .then(() => {
        // Intentionally empty - fire and forget
      });

    return {
      valid: true,
      keyId: data.id,
      keyName: data.name,
      permissions,
    };
  } catch (err) {
    console.error('[validateServiceKey] Error:', err);
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
 * Wrapper for API routes that require service API key authentication
 *
 * @param request - Next.js request
 * @param requiredPermissions - Permissions required for this endpoint
 * @param handler - Handler function to run if authenticated
 *
 * @example
 * export async function GET(request: NextRequest) {
 *   return withServiceAuth(request, ['read'], async (keyInfo) => {
 *     return NextResponse.json({ data: 'example' });
 *   });
 * }
 */
export async function withServiceAuth<T>(
  request: NextRequest,
  requiredPermissions: string[],
  handler: (keyInfo: { keyId: string; keyName: string; permissions: string[] }) => Promise<NextResponse<T | { error: string }>>
): Promise<NextResponse<T | { error: string }>> {
  const validation = await validateServiceKey(request, requiredPermissions);

  if (!validation.valid) {
    return NextResponse.json({ error: validation.error || 'Unauthorized' }, { status: 401 });
  }

  return handler({
    keyId: validation.keyId!,
    keyName: validation.keyName!,
    permissions: validation.permissions!,
  });
}

/**
 * Generate a new service API key
 *
 * @returns Object containing the key (show once) and hash (store in DB)
 */
export function generateServiceKey(): { key: string; keyHash: string; keyPrefix: string } {
  // Generate 32 random bytes and encode as hex
  const randomPart = randomBytes(32).toString('hex').substring(0, 32);

  const key = `hb_sk_${randomPart}`;
  const keyHash = createHash('sha256').update(key).digest('hex');
  const keyPrefix = key.substring(0, 11); // "hb_sk_xxxx"

  return { key, keyHash, keyPrefix };
}

/**
 * Get the system user ID for service operations
 *
 * Uses SYSTEM_USER_ID env var if set, otherwise queries the first profile.
 * This is used for operations that require a user_id but are performed by
 * automated systems (like Peter).
 *
 * @returns The user ID to use for service operations
 * @throws Error if no user can be found
 */
export async function getSystemUserId(): Promise<string> {
  // Check env var first
  if (process.env.SYSTEM_USER_ID) {
    return process.env.SYSTEM_USER_ID;
  }

  // Fall back to first profile (single-user system)
  const supabase = createServiceRoleClient();
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id')
    .limit(1)
    .single();

  if (error || !profile) {
    throw new Error('No system user configured. Set SYSTEM_USER_ID env var or ensure a profile exists.');
  }

  return profile.id;
}

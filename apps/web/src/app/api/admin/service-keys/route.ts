/**
 * Service API Keys Admin Route
 *
 * POST - Generate a new service API key
 * GET - List all service API keys (without revealing actual keys)
 * DELETE - Revoke a service API key
 *
 * Only authenticated users can manage service keys.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { generateServiceKey } from '@/lib/middleware/service-auth';
import { z } from 'zod';

const CreateKeySchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.enum(['read', 'write', 'admin'])).min(1).default(['read']),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

const RevokeKeySchema = z.object({
  keyId: z.string().uuid(),
});

/**
 * POST - Generate a new service API key
 *
 * IMPORTANT: The actual key is only returned ONCE in this response.
 * It is not stored in the database - only the hash is stored.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check auth
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse body
    const body = await request.json();
    const parsed = CreateKeySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, permissions, expiresInDays } = parsed.data;

    // Generate the key
    const { key, keyHash, keyPrefix } = generateServiceKey();

    // Calculate expiration if specified
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    // Store in database (using service role to bypass RLS)
    const serviceClient = createServiceRoleClient();
    const { data: inserted, error: insertError } = await serviceClient
      .from('service_api_keys')
      .insert({
        name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        permissions,
        expires_at: expiresAt,
        created_by: user.id,
      })
      .select('id, name, key_prefix, permissions, created_at, expires_at')
      .single();

    if (insertError) {
      console.error('[POST /api/admin/service-keys] Insert error:', insertError);
      return NextResponse.json(
        { error: 'Failed to create API key' },
        { status: 500 }
      );
    }

    // Return the key - THIS IS THE ONLY TIME THE FULL KEY IS SHOWN
    return NextResponse.json({
      success: true,
      message: 'API key created. Copy this key now - it will not be shown again.',
      key, // The actual key - only shown once!
      keyDetails: {
        id: inserted.id,
        name: inserted.name,
        prefix: inserted.key_prefix,
        permissions: inserted.permissions,
        createdAt: inserted.created_at,
        expiresAt: inserted.expires_at,
      },
    });
  } catch (error) {
    console.error('[POST /api/admin/service-keys] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET - List all service API keys
 *
 * Returns key metadata but NOT the actual keys (they're hashed)
 */
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check auth
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all keys (using service role to bypass RLS)
    const serviceClient = createServiceRoleClient();
    const { data: keys, error: queryError } = await serviceClient
      .from('service_api_keys')
      .select('id, name, key_prefix, permissions, created_at, last_used_at, expires_at, revoked_at, created_by')
      .order('created_at', { ascending: false });

    if (queryError) {
      console.error('[GET /api/admin/service-keys] Query error:', queryError);
      return NextResponse.json(
        { error: 'Failed to fetch API keys' },
        { status: 500 }
      );
    }

    // Mark expired/revoked keys
    const keysWithStatus = (keys || []).map((key) => ({
      ...key,
      status: key.revoked_at
        ? 'revoked'
        : key.expires_at && new Date(key.expires_at) < new Date()
          ? 'expired'
          : 'active',
    }));

    return NextResponse.json({
      keys: keysWithStatus,
      total: keysWithStatus.length,
      active: keysWithStatus.filter((k) => k.status === 'active').length,
    });
  } catch (error) {
    console.error('[GET /api/admin/service-keys] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Revoke a service API key
 *
 * Sets revoked_at timestamp (doesn't actually delete the row for audit trail)
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check auth
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse body
    const body = await request.json();
    const parsed = RevokeKeySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { keyId } = parsed.data;

    // Revoke the key (using service role to bypass RLS)
    const serviceClient = createServiceRoleClient();
    const { data: updated, error: updateError } = await serviceClient
      .from('service_api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', keyId)
      .is('revoked_at', null) // Only revoke if not already revoked
      .select('id, name, key_prefix')
      .single();

    if (updateError) {
      if (updateError.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'API key not found or already revoked' },
          { status: 404 }
        );
      }
      console.error('[DELETE /api/admin/service-keys] Update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to revoke API key' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `API key "${updated.name}" (${updated.key_prefix}...) has been revoked`,
      keyId: updated.id,
    });
  } catch (error) {
    console.error('[DELETE /api/admin/service-keys] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

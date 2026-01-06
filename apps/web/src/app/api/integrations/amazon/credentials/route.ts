/**
 * Amazon Credentials API
 *
 * POST: Save Amazon SP-API credentials
 * DELETE: Remove Amazon credentials
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { AmazonSyncService } from '@/lib/services/amazon-sync.service';

const CredentialsSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  refreshToken: z.string().min(1, 'Refresh Token is required'),
  sellerId: z.string().min(1, 'Seller ID is required'),
  marketplaceIds: z.array(z.string()).optional(),
});

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
    const parsed = CredentialsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const credentials = {
      ...parsed.data,
      // Default to EU marketplaces if not specified
      marketplaceIds: parsed.data.marketplaceIds || [
        'A1F83G8C2ARO7P', // UK
        'A1PA6795UKMFR9', // DE
        'A13V1IB3VIYBER', // FR
        'APJ6JRA9NG5V4', // IT
        'A1RKKUPIHCS9HS', // ES
      ],
    };

    const syncService = new AmazonSyncService(supabase);

    // Test connection before saving
    const isValid = await syncService.testConnectionWithCredentials(credentials);

    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid credentials - could not connect to Amazon SP-API' },
        { status: 400 }
      );
    }

    // Save credentials
    await syncService.saveCredentials(user.id, credentials);

    return NextResponse.json({
      success: true,
      message: 'Amazon credentials saved successfully',
    });
  } catch (error) {
    console.error('[POST /api/integrations/amazon/credentials] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const syncService = new AmazonSyncService(supabase);
    await syncService.deleteCredentials(user.id);

    return NextResponse.json({
      success: true,
      message: 'Amazon credentials deleted successfully',
    });
  } catch (error) {
    console.error('[DELETE /api/integrations/amazon/credentials] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

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

    const syncService = new AmazonSyncService(supabase);
    const status = await syncService.getSyncStatus(user.id);

    return NextResponse.json({
      isConfigured: status.isConfigured,
      totalOrders: status.totalOrders,
      lastSyncedAt: status.lastSyncedAt?.toISOString() || null,
    });
  } catch (error) {
    console.error('[GET /api/integrations/amazon/credentials] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

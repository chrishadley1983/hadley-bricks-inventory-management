/**
 * Monzo Sync Route
 *
 * Syncs Monzo transactions from Google Sheets source.
 * GET /api/integrations/monzo/sync - Get sync status
 * POST /api/integrations/monzo/sync - Trigger sync
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { monzoSheetsSyncService } from '@/lib/monzo/monzo-sheets-sync.service';

// Schema for POST request
const SyncRequestSchema = z.object({
  type: z.enum(['full', 'incremental']).optional().default('incremental'),
});

/**
 * GET - Get current sync status
 */
export async function GET() {
  try {
    // 1. Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Get sync status from sheets service
    const syncStatus = await monzoSheetsSyncService.getSyncStatus(user.id);

    return NextResponse.json({
      data: syncStatus,
    });
  } catch (error) {
    console.error('[GET /api/integrations/monzo/sync] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST - Trigger a sync from Google Sheets
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Check if sync is already running
    const syncStatus = await monzoSheetsSyncService.getSyncStatus(user.id);
    if (syncStatus.isRunning) {
      return NextResponse.json(
        { error: 'A sync is already in progress. Please wait for it to complete.' },
        { status: 409 }
      );
    }

    // 3. Parse and validate request body
    let body = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is fine, will use defaults
    }

    const parsed = SyncRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // 4. Perform sync from Google Sheets
    const result =
      parsed.data.type === 'full'
        ? await monzoSheetsSyncService.performFullSync(user.id)
        : await monzoSheetsSyncService.performIncrementalSync(user.id);

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Sync failed' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        success: true,
        syncType: parsed.data.type,
        transactionsProcessed: result.transactionsProcessed,
        transactionsCreated: result.transactionsCreated,
        transactionsUpdated: result.transactionsUpdated,
      },
    });
  } catch (error) {
    console.error('[POST /api/integrations/monzo/sync] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

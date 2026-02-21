/**
 * ASIN Discovery API Routes
 *
 * GET - Get discovery status summary
 * POST - Trigger discovery actions (initialize, run, retry)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import type { AmazonCredentials } from '@/lib/amazon/types';
import { SeededAsinDiscoveryService } from '@/lib/arbitrage/seeded-discovery.service';
import { z } from 'zod';

// =============================================================================
// SCHEMAS
// =============================================================================

const DiscoveryActionSchema = z.object({
  action: z.enum(['initialize', 'run', 'retry_not_found']),
  // Default 0 means "process all pending" - no artificial limit
  limit: z.number().int().min(0).max(50000).optional().default(0),
});

// =============================================================================
// GET - Get discovery status summary
// =============================================================================

export async function GET() {
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

    // Use the seeded_discovery_summary view for accurate counts (avoids 1000 row limit)
    const { data: summaryData } = await supabase
      .from('seeded_discovery_summary')
      .select('*')
      .single();

    interface SummaryData {
      pending: number;
      found: number;
      notFound: number;
      multiple: number;
      excluded: number;
      total: number;
      foundPercent: number;
      avgConfidence: number | null;
      lastDiscoveryAt: string | null;
    }

    const summary: SummaryData = summaryData
      ? {
          pending: summaryData.pending_count ?? 0,
          found: summaryData.found_count ?? 0,
          notFound: summaryData.not_found_count ?? 0,
          multiple: summaryData.multiple_count ?? 0,
          excluded: summaryData.excluded_count ?? 0,
          total: summaryData.total_count ?? 0,
          foundPercent: summaryData.found_percent ? Number(summaryData.found_percent) : 0,
          avgConfidence: summaryData.avg_confidence
            ? Math.round(summaryData.avg_confidence * 100) / 100
            : null,
          lastDiscoveryAt: summaryData.last_discovery_at,
        }
      : {
          pending: 0,
          found: 0,
          notFound: 0,
          multiple: 0,
          excluded: 0,
          total: 0,
          foundPercent: 0,
          avgConfidence: null,
          lastDiscoveryAt: null,
        };

    // Get sync status for discovery job
    const { data: syncStatus } = await supabase
      .from('arbitrage_sync_status')
      .select('*')
      .eq('user_id', user.id)
      .eq('job_type', 'seeded_discovery')
      .single();

    return NextResponse.json({
      summary,
      syncStatus: syncStatus
        ? {
            status: syncStatus.status,
            lastRunAt: syncStatus.last_run_at,
            lastSuccessAt: syncStatus.last_success_at,
            itemsProcessed: syncStatus.items_processed,
            totalItems: syncStatus.total_items,
            itemsFailed: syncStatus.items_failed,
            errorMessage: syncStatus.error_message,
          }
        : null,
    });
  } catch (error) {
    console.error('[GET /api/arbitrage/discovery] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// =============================================================================
// POST - Trigger discovery actions
// =============================================================================

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

    // Parse and validate body
    const body = await request.json();
    const parsed = DiscoveryActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { action, limit } = parsed.data;

    // Get Amazon credentials
    const credentialsRepo = new CredentialsRepository(supabase);
    const credentials = await credentialsRepo.getCredentials<AmazonCredentials>(user.id, 'amazon');
    if (!credentials) {
      return NextResponse.json({ error: 'Amazon credentials not configured' }, { status: 400 });
    }

    // Create discovery service with service role client (bypasses RLS for seeded_asins writes)
    const serviceRoleClient = createServiceRoleClient();
    const discoveryService = new SeededAsinDiscoveryService(serviceRoleClient, credentials);

    // Update sync status to running
    await updateSyncStatus(supabase, user.id, 'running');

    let result;
    try {
      switch (action) {
        case 'initialize':
          result = await discoveryService.initializeSeededAsins();
          await updateSyncStatus(supabase, user.id, 'completed', {
            items_processed: result.created,
            items_failed: 0,
          });
          return NextResponse.json({
            success: true,
            message: `Initialized ${result.created} seeded ASINs (${result.skipped} already existed)`,
            result,
          });

        case 'run':
          // Get total pending count for progress tracking
          const { count: totalPending } = await supabase
            .from('seeded_asins')
            .select('*', { count: 'exact', head: true })
            .eq('discovery_status', 'pending');

          // limit=0 means "process all pending", otherwise cap at limit
          const effectiveLimit = limit === 0 ? (totalPending ?? 0) : limit;
          const totalToProcess = Math.min(effectiveLimit, totalPending ?? 0);

          // Run discovery with progress callback that updates the database
          result = await discoveryService.runDiscovery(
            effectiveLimit,
            undefined,
            async (processed, total, found, currentSet) => {
              // Update progress in sync status table every 10 items
              if (processed % 10 === 0 || processed === total) {
                await supabase
                  .from('arbitrage_sync_status')
                  .update({
                    items_processed: processed,
                    total_items: totalToProcess,
                    status: 'running',
                    error_message: currentSet ? `Processing: ${currentSet}` : null,
                  })
                  .eq('user_id', user.id)
                  .eq('job_type', 'seeded_discovery');
              }
            }
          );
          await updateSyncStatus(supabase, user.id, 'completed', {
            items_processed: result.processed,
            total_items: totalToProcess,
            items_failed: result.errors,
            last_run_duration_ms: result.durationMs,
          });
          return NextResponse.json({
            success: true,
            message: `Discovery complete: ${result.found} found, ${result.notFound} not found, ${result.multiple} need review`,
            result,
          });

        case 'retry_not_found':
          result = await discoveryService.retryNotFound(limit);
          await updateSyncStatus(supabase, user.id, 'completed', {
            items_processed: result.processed,
            items_failed: result.errors,
            last_run_duration_ms: result.durationMs,
          });
          return NextResponse.json({
            success: true,
            message: `Retry complete: ${result.found} newly found`,
            result,
          });

        default:
          return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
      }
    } catch (jobError) {
      const errorMessage = jobError instanceof Error ? jobError.message : 'Unknown error';
      await updateSyncStatus(supabase, user.id, 'failed', {
        error_message: errorMessage,
      });
      throw jobError;
    }
  } catch (error) {
    console.error('[POST /api/arbitrage/discovery] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// =============================================================================
// HELPERS
// =============================================================================

async function updateSyncStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  status: 'running' | 'completed' | 'failed',
  extras?: {
    items_processed?: number;
    total_items?: number;
    items_failed?: number;
    last_run_duration_ms?: number;
    error_message?: string;
  }
) {
  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = {
    status,
    last_run_at: now,
    ...(status === 'completed' && { last_success_at: now }),
    ...extras,
  };

  await supabase.from('arbitrage_sync_status').upsert(
    {
      user_id: userId,
      job_type: 'seeded_discovery',
      ...updateData,
    },
    { onConflict: 'user_id,job_type' }
  );
}

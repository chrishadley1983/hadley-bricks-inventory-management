/**
 * Arbitrage Sync API Routes
 *
 * GET /api/arbitrage/sync - Get sync status
 * POST /api/arbitrage/sync - Trigger sync job
 */

import { NextRequest, NextResponse } from 'next/server';

// Increase timeout for sync operations (max 5 minutes for Pro plan, 60s for Hobby)
export const maxDuration = 300;
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  ArbitrageService,
  AmazonArbitrageSyncService,
  BrickLinkArbitrageSyncService,
  EbayArbitrageSyncService,
  MappingService,
} from '@/lib/arbitrage';

// ============================================================================
// SCHEMAS
// ============================================================================

const TriggerSyncSchema = z.object({
  jobType: z.enum(['inventory_asins', 'amazon_pricing', 'bricklink_pricing', 'asin_mapping', 'ebay_pricing', 'all']),
});

// ============================================================================
// GET - Get sync status
// ============================================================================

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

    const service = new ArbitrageService(supabase);
    const status = await service.getSyncStatus(user.id);
    const stats = await service.getSummaryStats(user.id);

    return NextResponse.json({
      data: {
        syncStatus: status,
        stats,
      },
    });
  } catch (error) {
    console.error('[GET /api/arbitrage/sync] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - Trigger sync job
// ============================================================================

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
    const parsed = TriggerSyncSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { jobType } = parsed.data;
    const results: Record<string, unknown> = {};

    // Update status to running
    const arbitrageService = new ArbitrageService(supabase);

    if (jobType === 'all' || jobType === 'inventory_asins') {
      await arbitrageService.updateSyncStatus(user.id, 'inventory_asins', { status: 'running' });
      try {
        const amazonSyncService = new AmazonArbitrageSyncService(supabase);
        results.inventoryAsins = await amazonSyncService.syncInventoryAsins(user.id);
      } catch (error) {
        console.error('[POST /api/arbitrage/sync] inventory_asins error:', error);
        results.inventoryAsins = { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    if (jobType === 'all' || jobType === 'asin_mapping') {
      await arbitrageService.updateSyncStatus(user.id, 'asin_mapping', { status: 'running' });
      try {
        const mappingService = new MappingService(supabase);
        results.asinMapping = await mappingService.mapAllUnmapped(user.id);
      } catch (error) {
        console.error('[POST /api/arbitrage/sync] asin_mapping error:', error);
        results.asinMapping = { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    // NOTE: amazon_pricing is NOT included in 'all' sync due to strict rate limits (30 sec/request)
    // It runs via scheduled cron job at 4am instead. Can still be triggered individually.
    if (jobType === 'amazon_pricing') {
      await arbitrageService.updateSyncStatus(user.id, 'amazon_pricing', { status: 'running' });
      try {
        const amazonSyncService = new AmazonArbitrageSyncService(supabase);
        results.amazonPricing = await amazonSyncService.syncPricing(user.id);
      } catch (error) {
        console.error('[POST /api/arbitrage/sync] amazon_pricing error:', error);
        results.amazonPricing = { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    if (jobType === 'all' || jobType === 'bricklink_pricing') {
      await arbitrageService.updateSyncStatus(user.id, 'bricklink_pricing', { status: 'running' });
      try {
        const brickLinkSyncService = new BrickLinkArbitrageSyncService(supabase);
        results.bricklinkPricing = await brickLinkSyncService.syncPricing(user.id);
      } catch (error) {
        console.error('[POST /api/arbitrage/sync] bricklink_pricing error:', error);
        results.bricklinkPricing = { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    if (jobType === 'all' || jobType === 'ebay_pricing') {
      await arbitrageService.updateSyncStatus(user.id, 'ebay_pricing', { status: 'running' });
      try {
        const ebaySyncService = new EbayArbitrageSyncService(supabase);
        results.ebayPricing = await ebaySyncService.syncPricing(user.id);
      } catch (error) {
        console.error('[POST /api/arbitrage/sync] ebay_pricing error:', error);
        results.ebayPricing = { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    return NextResponse.json({
      data: results,
      message: `Sync completed for: ${jobType}`,
    });
  } catch (error) {
    console.error('[POST /api/arbitrage/sync] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

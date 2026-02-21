/**
 * /api/ebay/best-offer/bulk-update
 *
 * POST: Bulk update Best Offer thresholds for eBay listings
 *
 * This endpoint applies auto-accept and auto-decline thresholds to multiple
 * listings based on percentage rules.
 *
 * Request body:
 * {
 *   autoDeclinePercent: number,   // e.g. 70 = reject offers below 70%
 *   autoAcceptPercent: number,    // e.g. 90 = accept offers at/above 90%
 *   enableBestOffer: boolean,     // Whether to enable Best Offer
 *   filter?: 'all' | 'without_best_offer' | 'missing_thresholds', // Which listings to update
 *   itemIds?: string[]            // Optional specific item IDs to update
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  createBestOfferBulkUpdateService,
  type ListingInput,
} from '@/lib/ebay/best-offer-bulk-update.service';

// ============================================================================
// Validation Schema
// ============================================================================

const BulkUpdateSchema = z
  .object({
    autoDeclinePercent: z
      .number()
      .min(0, 'Auto-decline percent must be at least 0')
      .max(100, 'Auto-decline percent must be at most 100'),
    autoAcceptPercent: z
      .number()
      .min(0, 'Auto-accept percent must be at least 0')
      .max(100, 'Auto-accept percent must be at most 100'),
    enableBestOffer: z.boolean(),
    filter: z.enum(['all', 'without_best_offer', 'missing_thresholds']).optional().default('all'),
    itemIds: z.array(z.string()).optional(),
    dryRun: z.boolean().optional().default(false),
  })
  .refine((data) => data.autoDeclinePercent < data.autoAcceptPercent, {
    message: 'Auto-decline percent must be less than auto-accept percent',
  });

// ============================================================================
// POST Handler
// ============================================================================

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

    // 2. Parse and validate request body
    const body = await request.json();
    const parsed = BulkUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { autoDeclinePercent, autoAcceptPercent, enableBestOffer, filter, itemIds, dryRun } =
      parsed.data;

    // 3. Create service
    const service = createBestOfferBulkUpdateService(supabase, user.id);

    // 4. Get listings to update based on filter
    let listings: ListingInput[];

    if (itemIds && itemIds.length > 0) {
      // Specific item IDs provided - fetch their prices from database
      const allListings = await service.getActiveListingsForUpdate();
      listings = allListings.filter((l) => itemIds.includes(l.itemId));

      if (listings.length === 0) {
        return NextResponse.json(
          { error: 'No matching active listings found for the provided item IDs' },
          { status: 404 }
        );
      }
    } else {
      // Use filter to determine which listings to update
      switch (filter) {
        case 'without_best_offer':
          listings = await service.getListingsWithoutBestOffer();
          break;
        case 'missing_thresholds':
          listings = await service.getListingsWithMissingThresholds();
          break;
        case 'all':
        default:
          listings = await service.getActiveListingsForUpdate();
          break;
      }
    }

    if (listings.length === 0) {
      return NextResponse.json(
        { error: 'No listings found matching the specified filter' },
        { status: 404 }
      );
    }

    // 5. If dry run, return preview of what would be updated
    if (dryRun) {
      const preview = listings.map((listing) => {
        const autoDeclinePrice =
          Math.round(listing.currentPrice * (autoDeclinePercent / 100) * 100) / 100;
        const autoAcceptPrice =
          Math.round(listing.currentPrice * (autoAcceptPercent / 100) * 100) / 100;
        return {
          itemId: listing.itemId,
          currentPrice: listing.currentPrice,
          currency: listing.currency,
          proposedAutoDeclinePrice: autoDeclinePrice,
          proposedAutoAcceptPrice: autoAcceptPrice,
          manualReviewRange: `${listing.currency} ${autoDeclinePrice.toFixed(2)} - ${autoAcceptPrice.toFixed(2)}`,
        };
      });

      return NextResponse.json({
        data: {
          dryRun: true,
          message: `Would update ${listings.length} listing(s)`,
          totalListings: listings.length,
          rules: {
            autoDeclinePercent,
            autoAcceptPercent,
            enableBestOffer,
          },
          preview: preview.slice(0, 20), // Return first 20 for preview
          totalPreviewItems: preview.length,
        },
      });
    }

    // 6. Execute bulk update
    console.log(
      `[POST /api/ebay/best-offer/bulk-update] Starting update for ${listings.length} listings`
    );

    const result = await service.bulkUpdateBestOfferThresholds(listings, {
      autoDeclinePercent,
      autoAcceptPercent,
      enableBestOffer,
    });

    // 7. Return response
    return NextResponse.json({
      data: {
        message: `Best Offer thresholds updated for ${result.summary.succeeded} of ${result.summary.total} listings`,
        summary: result.summary,
        rules: {
          autoDeclinePercent,
          autoAcceptPercent,
          enableBestOffer,
        },
        successful: result.successful,
        failed: result.failed,
      },
    });
  } catch (error) {
    console.error('[POST /api/ebay/best-offer/bulk-update] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Internal server error';

    if (errorMessage.includes('not connected')) {
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

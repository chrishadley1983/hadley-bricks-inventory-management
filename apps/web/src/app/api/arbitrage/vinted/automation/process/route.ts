/**
 * Vinted Scan Processing API
 *
 * POST - Process scan results from Claude Code
 *
 * This endpoint receives scan results, calculates arbitrage metrics,
 * stores opportunities, updates stats, and sends notifications.
 *
 * AUTH1: Validates X-Api-Key header
 * PROC1-PROC4: Validates request against ProcessRequestSchema
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { extractSetNumber } from '@/lib/utils/set-number-extraction';
import {
  calculateTotalCost,
  calculateCogPercent,
  calculateProfit,
  calculateRoi,
  isViable,
  isNearMiss,
  VINTED_SHIPPING_COST,
} from '@/lib/utils/arbitrage-calculations';
import { AsinMatchingService } from '@/lib/services/asin-matching.service';
import { AmazonPricingClient } from '@/lib/amazon/amazon-pricing.client';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import { discordService } from '@/lib/notifications';
import { withApiKeyAuth } from '@/lib/middleware/vinted-api-auth';
import { ProcessRequestSchema } from '@/types/vinted-automation';
import type { AmazonCredentials } from '@/lib/amazon/types';

// =============================================================================
// TYPES
// =============================================================================

interface ProcessedListing {
  setNumber: string;
  title: string;
  vintedPrice: number;
  vintedUrl: string;
  vintedListingId: string;
  amazonPrice: number | null;
  asin: string | null;
  setName: string | null;
  totalCost: number;
  cogPercent: number | null;
  profit: number | null;
  roi: number | null;
  isViable: boolean;
  isNearMiss: boolean;
  listedAt: string | null;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Extract Vinted listing ID from URL
 * e.g., https://www.vinted.co.uk/items/123456-title -> 123456
 */
function extractListingId(url: string): string {
  const match = url.match(/\/items\/(\d+)/);
  return match ? match[1] : url;
}

// =============================================================================
// POST - Process scan results (AUTH1: Validates X-Api-Key header)
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function POST(request: NextRequest): Promise<NextResponse<any>> {
  return withApiKeyAuth<Record<string, unknown>>(request, async (userId) => {
    // Use service role client since API key auth bypasses RLS
    const supabase = createServiceRoleClient();

    // Parse request body using ProcessRequestSchema (PROC1)
    const body = await request.json();
    const parsed = ProcessRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Extract fields (PROC2: scanId, PROC3: scanType, PROC4: setNumber)
    const { scanType, setNumber, result } = parsed.data;
    const { listings, captchaDetected, timingDelayMs } = result;

    // Validate watchlist has setNumber
    if (scanType === 'watchlist' && !setNumber) {
      return NextResponse.json({ error: 'setNumber required for watchlist scan' }, { status: 400 });
    }

    try {
      // Get scanner config for thresholds
      const { data: config } = await supabase
        .from('vinted_scanner_config')
        .select('*')
        .eq('user_id', userId)
        .single();

      const cogThreshold =
        scanType === 'broad_sweep'
          ? config?.broad_sweep_cog_threshold || 40
          : config?.watchlist_cog_threshold || 40;
      const nearMissThreshold = config?.near_miss_threshold || 50;

      // =========================================================================
      // Handle CAPTCHA detection
      // =========================================================================

      if (captchaDetected) {
        // Auto-pause scanner and enable recovery mode
        // Recovery mode starts at 25% rate and ramps up over 6 days
        await supabase
          .from('vinted_scanner_config')
          .update({
            paused: true,
            pause_reason: 'CAPTCHA detected - auto-paused for safety',
            // DataDome hardening: Enable recovery mode
            captcha_detected_at: new Date().toISOString(),
            recovery_mode: true,
            recovery_rate_percent: 25, // Start at 25% rate
            captcha_count_30d: (config?.captcha_count_30d ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId);

        // Log the scan with captcha status
        await supabase.from('vinted_scan_log').insert({
          user_id: userId,
          scan_type: scanType,
          set_number: setNumber || null,
          status: 'captcha',
          listings_found: 0,
          opportunities_found: 0,
          timing_delay_ms: timingDelayMs,
          completed_at: new Date().toISOString(),
        });

        // Send CAPTCHA warning notification with recovery mode info
        await discordService.sendVintedCaptchaWarning();

        return NextResponse.json({
          success: false,
          captchaDetected: true,
          message: 'Scanner paused due to CAPTCHA detection',
        });
      }

      // =========================================================================
      // Extract set numbers from listings
      // =========================================================================

      const listingsWithSets: Array<{
        listing: (typeof listings)[0];
        extractedSetNumber: string;
      }> = [];

      for (const listing of listings) {
        const extracted = extractSetNumber(listing.title);
        if (extracted) {
          listingsWithSets.push({
            listing,
            extractedSetNumber: extracted,
          });
        }
      }

      // For watchlist scans, filter to only the target set
      const filteredListings =
        scanType === 'watchlist'
          ? listingsWithSets.filter((l) => l.extractedSetNumber === setNumber)
          : listingsWithSets;

      // Get unique set numbers for ASIN lookup
      const uniqueSetNumbers = [...new Set(filteredListings.map((l) => l.extractedSetNumber))];

      // =========================================================================
      // Fetch Amazon pricing - use watchlist data for watchlist scans
      // =========================================================================

      // Build pricing map: setNumber -> { asin, amazonPrice, setName }
      const amazonPricing = new Map<
        string,
        {
          asin: string | null;
          ukRetailPrice: number | null;
          setName: string | null;
          buyBoxPrice?: number | null;
        }
      >();

      if (scanType === 'watchlist' && setNumber) {
        // For watchlist scans, get ASIN from vinted_watchlist and price from amazon_arbitrage_pricing
        const { data: watchlistItem } = await supabase
          .from('vinted_watchlist')
          .select('asin')
          .eq('user_id', userId)
          .eq('set_number', setNumber)
          .single();

        // Always fetch set name from brickset_sets
        const bricksetSetNumber = `${setNumber}-1`;
        const { data: bricksetData } = await supabase
          .from('brickset_sets')
          .select('set_name')
          .eq('set_number', bricksetSetNumber)
          .single();

        const setName = bricksetData?.set_name ?? null;

        if (watchlistItem?.asin) {
          // Get latest pricing from amazon_arbitrage_pricing
          const { data: pricing } = await supabase
            .from('amazon_arbitrage_pricing')
            .select('buy_box_price, lowest_offer_price')
            .eq('asin', watchlistItem.asin)
            .order('snapshot_date', { ascending: false })
            .limit(1)
            .single();

          const buyBoxPrice = pricing?.buy_box_price ?? pricing?.lowest_offer_price ?? null;

          amazonPricing.set(setNumber, {
            asin: watchlistItem.asin,
            ukRetailPrice: null,
            setName,
            buyBoxPrice,
          });
        } else {
          // Even without ASIN, store set name for display
          amazonPricing.set(setNumber, {
            asin: null,
            ukRetailPrice: null,
            setName,
            buyBoxPrice: null,
          });
        }
      } else {
        // For broad sweeps, use seeded_asins lookup
        const asinService = new AsinMatchingService(supabase);
        const seededMatches = await asinService.matchMultiple(uniqueSetNumbers);

        // Copy to our pricing map
        for (const [setNum, match] of seededMatches) {
          amazonPricing.set(setNum, { ...match, buyBoxPrice: null });
        }

        // Try to get live Buy Box prices if credentials exist
        try {
          const credentialsRepo = new CredentialsRepository(supabase);
          const credentials = await credentialsRepo.getCredentials<AmazonCredentials>(
            userId,
            'amazon'
          );

          if (credentials) {
            const amazonClient = new AmazonPricingClient(credentials);
            const pricesWithBuyBox = await asinService.getAmazonPrices(
              uniqueSetNumbers,
              amazonClient
            );
            for (const [setNum, match] of pricesWithBuyBox) {
              amazonPricing.set(setNum, match);
            }
          }
        } catch (err) {
          console.warn('[process] Amazon pricing failed, using RRP fallback:', err);
        }
      }

      // =========================================================================
      // Calculate arbitrage for each listing
      // =========================================================================

      const processedListings: ProcessedListing[] = [];

      for (const { listing, extractedSetNumber } of filteredListings) {
        const asinMatch = amazonPricing.get(extractedSetNumber);
        // Check if we have live pricing with buyBoxPrice, otherwise fall back to ukRetailPrice
        const matchWithPricing = asinMatch as { buyBoxPrice?: number | null } | undefined;
        const amazonPrice = matchWithPricing?.buyBoxPrice ?? asinMatch?.ukRetailPrice ?? null;

        const totalCost = calculateTotalCost(listing.price, VINTED_SHIPPING_COST);
        const cogPercent = calculateCogPercent(totalCost, amazonPrice);
        const profit = calculateProfit(amazonPrice, totalCost);
        const roi = calculateRoi(profit, totalCost);

        processedListings.push({
          setNumber: extractedSetNumber,
          title: listing.title,
          vintedPrice: listing.price,
          vintedUrl: listing.url,
          vintedListingId: extractListingId(listing.url),
          amazonPrice,
          asin: asinMatch?.asin || null,
          setName: asinMatch?.setName || null,
          totalCost,
          cogPercent,
          profit,
          roi,
          isViable: isViable(cogPercent, cogThreshold),
          isNearMiss: isNearMiss(cogPercent, cogThreshold, nearMissThreshold),
          listedAt: listing.listedAt || null,
        });
      }

      // =========================================================================
      // Store opportunities
      // =========================================================================

      const viableListings = processedListings.filter((l) => l.isViable);
      const nearMissListings = processedListings.filter((l) => l.isNearMiss);

      // Create scan log first - include full scan results for UI display
      const { data: scanLog, error: scanLogError } = await supabase
        .from('vinted_scan_log')
        .insert({
          user_id: userId,
          scan_type: scanType,
          set_number: setNumber || null,
          status: 'success',
          listings_found: processedListings.length,
          opportunities_found: viableListings.length,
          timing_delay_ms: timingDelayMs,
          completed_at: new Date().toISOString(),
          scan_results: {
            processedListings: processedListings.map((l) => ({
              setNumber: l.setNumber,
              title: l.title,
              vintedPrice: l.vintedPrice,
              vintedUrl: l.vintedUrl,
              amazonPrice: l.amazonPrice,
              asin: l.asin,
              setName: l.setName,
              totalCost: l.totalCost,
              cogPercent: l.cogPercent,
              profit: l.profit,
              roi: l.roi,
              isViable: l.isViable,
              isNearMiss: l.isNearMiss,
            })),
            summary: {
              totalListings: processedListings.length,
              viableCount: viableListings.length,
              nearMissCount: nearMissListings.length,
              setsIdentified: uniqueSetNumbers.length,
              cogThreshold,
              nearMissThreshold,
            },
          },
        })
        .select()
        .single();

      if (scanLogError) {
        console.error('[process] Failed to create scan log:', scanLogError);
      }

      // Check for previously dismissed listings - we should NOT re-add or notify for these
      let dismissedIds = new Set<string>();
      if (viableListings.length > 0) {
        const listingIds = viableListings.map((l) => l.vintedListingId);
        const { data: dismissedListings } = await supabase
          .from('vinted_opportunities')
          .select('vinted_listing_id')
          .eq('user_id', userId)
          .eq('status', 'dismissed')
          .in('vinted_listing_id', listingIds);

        dismissedIds = new Set((dismissedListings ?? []).map((d) => d.vinted_listing_id));

        if (dismissedIds.size > 0) {
          console.log(`[process] Found ${dismissedIds.size} dismissed listings - will skip`);
        }
      }

      // Filter viable listings to exclude dismissed ones
      const newViableListings = viableListings.filter(
        (listing) => !dismissedIds.has(listing.vintedListingId)
      );

      // Store viable opportunities (upsert to handle duplicates)
      if (newViableListings.length > 0) {
        const opportunities = newViableListings.map((listing) => ({
          user_id: userId,
          scan_log_id: scanLog?.id || null,
          vinted_listing_id: listing.vintedListingId,
          vinted_url: listing.vintedUrl,
          set_number: listing.setNumber,
          set_name: listing.setName,
          vinted_price: listing.vintedPrice,
          amazon_price: listing.amazonPrice,
          asin: listing.asin,
          cog_percent: listing.cogPercent,
          estimated_profit: listing.profit,
          is_viable: true,
          status: 'active',
          listed_at: listing.listedAt,
        }));

        // Use upsert to avoid duplicates (ON CONFLICT)
        const { error: oppError } = await supabase
          .from('vinted_opportunities')
          .upsert(opportunities, {
            onConflict: 'user_id,vinted_listing_id',
            ignoreDuplicates: false, // Update if exists (for active items only)
          });

        if (oppError) {
          console.error('[process] Failed to store opportunities:', oppError);
        }
      }

      // =========================================================================
      // Update watchlist stats (for watchlist scans)
      // =========================================================================

      if (scanType === 'watchlist' && setNumber) {
        const statsUpdate: Record<string, unknown> = {
          user_id: userId,
          set_number: setNumber,
          total_scans: 1, // Will be incremented
          listings_found: processedListings.length,
          viable_found: viableListings.length,
          near_miss_found: nearMissListings.length,
          updated_at: new Date().toISOString(),
        };

        if (processedListings.length > 0) {
          statsUpdate.last_listing_at = new Date().toISOString();
        }
        if (viableListings.length > 0) {
          statsUpdate.last_viable_at = new Date().toISOString();
        }

        // Upsert stats
        const { error: statsError } = await supabase.from('vinted_watchlist_stats').upsert(
          statsUpdate as {
            user_id: string;
            set_number: string;
            total_scans: number;
            listings_found: number;
            viable_found: number;
            near_miss_found: number;
            updated_at: string;
            last_listing_at?: string;
            last_viable_at?: string;
          },
          {
            onConflict: 'user_id,set_number',
          }
        );

        // If record existed, we need to increment - fetch and update
        if (!statsError) {
          const { data: existingStats } = await supabase
            .from('vinted_watchlist_stats')
            .select('total_scans, listings_found, viable_found, near_miss_found')
            .eq('user_id', userId)
            .eq('set_number', setNumber)
            .single();

          if (existingStats && existingStats.total_scans > 1) {
            // Record existed, increment counts
            await supabase
              .from('vinted_watchlist_stats')
              .update({
                total_scans: (existingStats.total_scans || 0) + 1,
                listings_found: (existingStats.listings_found || 0) + processedListings.length,
                viable_found: (existingStats.viable_found || 0) + viableListings.length,
                near_miss_found: (existingStats.near_miss_found || 0) + nearMissListings.length,
                updated_at: new Date().toISOString(),
              })
              .eq('user_id', userId)
              .eq('set_number', setNumber);
          }
        }
      }

      // =========================================================================
      // Send notifications for excellent opportunities (excluding dismissed)
      // =========================================================================

      let alertsSent = 0;
      for (const listing of newViableListings) {
        if (
          listing.cogPercent !== null &&
          listing.profit !== null &&
          listing.amazonPrice !== null
        ) {
          await discordService.sendOpportunity({
            setNumber: listing.setNumber,
            setName: listing.setName || listing.title,
            vintedPrice: listing.vintedPrice,
            amazonPrice: listing.amazonPrice,
            cogPercent: listing.cogPercent,
            profit: listing.profit,
            vintedUrl: listing.vintedUrl,
          });
          alertsSent++;
        }
      }

      // =========================================================================
      // Response
      // =========================================================================

      return NextResponse.json({
        success: true,
        scanLogId: scanLog?.id || null,
        summary: {
          listingsProcessed: processedListings.length,
          setsIdentified: uniqueSetNumbers.length,
          opportunitiesFound: newViableListings.length,
          dismissedSkipped: dismissedIds.size,
          nearMissesFound: nearMissListings.length,
          alertsSent,
        },
        opportunities: newViableListings.map((l) => ({
          id: l.vintedListingId,
          setNumber: l.setNumber,
          setName: l.setName,
          vintedPrice: l.vintedPrice,
          amazonPrice: l.amazonPrice,
          cogPercent: l.cogPercent,
          profit: l.profit,
          vintedUrl: l.vintedUrl,
        })),
      });
    } catch (error) {
      console.error('[process] Error:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      );
    }
  });
}

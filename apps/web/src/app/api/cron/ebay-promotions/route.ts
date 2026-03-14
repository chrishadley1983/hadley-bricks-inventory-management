/**
 * POST /api/cron/ebay-promotions
 *
 * Applies promotion schedules to eBay listings based on listing age.
 * For each enabled schedule, determines the correct bid percentage
 * per listing and adds/updates/removes promotions accordingly.
 *
 * Recommended schedule: Daily at 6am UTC
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { EbayPromotedListingsService } from '@/lib/ebay/ebay-promoted-listings.service';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

const JOB_TYPE = 'ebay-promotions';

interface ScheduleRow {
  id: string;
  user_id: string;
  campaign_id: string;
  campaign_name: string | null;
  enabled: boolean;
}

interface StageRow {
  schedule_id: string;
  days_threshold: number;
  bid_percentage: number;
}

interface ListingRow {
  ebay_item_id: string;
  listing_date: string | null;
  ebay_data: Record<string, unknown> | null;
}

export async function POST(request: NextRequest) {
  let execution: ExecutionHandle = noopHandle;

  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    execution = await jobExecutionService.start(JOB_TYPE, 'cron');
    const supabase = createServiceRoleClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    // 1. Get all enabled schedules
    const { data: schedules, error: schedErr } = await db
      .from('ebay_promoted_listings_schedules')
      .select('id, user_id, campaign_id, campaign_name, enabled')
      .eq('enabled', true);

    if (schedErr) throw new Error(`Failed to fetch schedules: ${schedErr.message}`);
    if (!schedules || schedules.length === 0) {
      await execution.complete({ message: 'No enabled schedules' });
      return NextResponse.json({ message: 'No enabled schedules', processed: 0 });
    }

    // 2. Get all stages for enabled schedules
    const scheduleIds = schedules.map((s: ScheduleRow) => s.id);
    const { data: stages, error: stagesErr } = await db
      .from('ebay_promoted_listings_stages')
      .select('schedule_id, days_threshold, bid_percentage')
      .in('schedule_id', scheduleIds)
      .order('days_threshold', { ascending: true });

    if (stagesErr) throw new Error(`Failed to fetch stages: ${stagesErr.message}`);

    // Group stages by schedule
    const stagesBySchedule = new Map<string, StageRow[]>();
    for (const stage of stages || []) {
      const existing = stagesBySchedule.get(stage.schedule_id) || [];
      existing.push(stage);
      stagesBySchedule.set(stage.schedule_id, existing);
    }

    const now = new Date();
    let totalAdded = 0;
    let totalUpdated = 0;
    let totalRemoved = 0;
    let totalErrors = 0;

    // 3. Process each schedule
    for (const schedule of schedules as ScheduleRow[]) {
      const scheduleStages = stagesBySchedule.get(schedule.id) || [];
      if (scheduleStages.length === 0) continue;

      console.log(
        `[Cron EbayPromotions] Processing schedule for campaign ${schedule.campaign_id} (${scheduleStages.length} stages)`
      );

      // Get eBay listings for this user that are on eBay platform
      // Paginate to handle >1000 rows
      const allListings: ListingRow[] = [];
      let offset = 0;
      const pageSize = 1000;
      while (true) {
        const { data: batch, error: listErr } = await supabase
          .from('inventory_items')
          .select('ebay_item_id, listing_date, ebay_data')
          .eq('user_id', schedule.user_id)
          .not('ebay_item_id', 'is', null)
          .eq('status', 'Listed')
          .range(offset, offset + pageSize - 1);

        if (listErr) {
          console.error(`[Cron EbayPromotions] Error fetching listings:`, listErr);
          break;
        }
        if (!batch || batch.length === 0) break;
        allListings.push(...(batch as unknown as ListingRow[]));
        if (batch.length < pageSize) break;
        offset += pageSize;
      }

      if (allListings.length === 0) continue;

      // Filter to listings with eBay item IDs and determine target bid
      const toAdd: Array<{ listingId: string; bidPercentage: string }> = [];
      const toUpdate: Array<{ listingId: string; bidPercentage: string }> = [];
      const toRemove: string[] = [];

      // Get current promotion status
      const service = new EbayPromotedListingsService(supabase, schedule.user_id);
      const ebayItemIds = allListings
        .map((l) => l.ebay_item_id)
        .filter((id): id is string => !!id);

      // Batch status checks (500 at a time)
      const statusMap = new Map<string, { isPromoted: boolean; bidPercentage?: string }>();
      for (let i = 0; i < ebayItemIds.length; i += 500) {
        const batch = ebayItemIds.slice(i, i + 500);
        try {
          const statuses = await service.getPromotionStatus(batch);
          for (const s of statuses) {
            statusMap.set(s.listingId, { isPromoted: s.isPromoted, bidPercentage: s.bidPercentage });
          }
        } catch (error) {
          console.error(`[Cron EbayPromotions] Error checking status:`, error);
          totalErrors++;
        }
      }

      // Determine actions for each listing
      for (const listing of allListings) {
        if (!listing.ebay_item_id) continue;

        // Calculate listing age in days
        let listingDate: Date | null = null;
        if (listing.listing_date) {
          listingDate = new Date(listing.listing_date);
        } else if (listing.ebay_data && typeof listing.ebay_data === 'object') {
          const ebayData = listing.ebay_data as Record<string, unknown>;
          if (ebayData.listingStartDate) {
            listingDate = new Date(ebayData.listingStartDate as string);
          }
        }

        if (!listingDate || isNaN(listingDate.getTime())) continue;

        const ageDays = Math.floor((now.getTime() - listingDate.getTime()) / (1000 * 60 * 60 * 24));

        // Find the applicable stage (highest days_threshold <= ageDays)
        let targetBid: string | null = null;
        for (let i = scheduleStages.length - 1; i >= 0; i--) {
          if (ageDays >= scheduleStages[i].days_threshold) {
            targetBid = scheduleStages[i].bid_percentage.toFixed(1);
            break;
          }
        }

        const current = statusMap.get(listing.ebay_item_id);

        if (targetBid === null) {
          // Listing is too new for any stage — should not be promoted
          if (current?.isPromoted) {
            toRemove.push(listing.ebay_item_id);
          }
        } else if (!current?.isPromoted) {
          // Not currently promoted — add it
          toAdd.push({ listingId: listing.ebay_item_id, bidPercentage: targetBid });
        } else if (current.bidPercentage !== targetBid) {
          // Already promoted but bid needs updating
          toUpdate.push({ listingId: listing.ebay_item_id, bidPercentage: targetBid });
        }
        // else: already at correct bid — no action needed
      }

      console.log(
        `[Cron EbayPromotions] Campaign ${schedule.campaign_id}: ${toAdd.length} to add, ${toUpdate.length} to update, ${toRemove.length} to remove`
      );

      // Apply changes
      try {
        if (toAdd.length > 0) {
          const result = await service.addListings(schedule.campaign_id, toAdd);
          totalAdded += result.successful.length;
          totalErrors += result.failed.length;
        }
        if (toUpdate.length > 0) {
          const result = await service.updateBidPercentages(schedule.campaign_id, toUpdate);
          totalUpdated += result.successful.length;
          totalErrors += result.failed.length;
        }
        if (toRemove.length > 0) {
          const result = await service.removeListings(schedule.campaign_id, toRemove);
          totalRemoved += result.successful.length;
          totalErrors += result.failed.length;
        }
      } catch (error) {
        console.error(`[Cron EbayPromotions] Error applying changes:`, error);
        totalErrors++;
      }
    }

    const summary = { added: totalAdded, updated: totalUpdated, removed: totalRemoved, errors: totalErrors };
    console.log(`[Cron EbayPromotions] Complete:`, summary);

    await execution.complete(summary);
    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    console.error('[Cron EbayPromotions] Fatal error:', error);
    await execution.fail(error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

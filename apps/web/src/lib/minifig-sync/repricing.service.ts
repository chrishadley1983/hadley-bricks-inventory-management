/**
 * Repricing Service (F65-F66)
 *
 * Detects stale published listings and re-runs market research
 * to update pricing based on fresh data.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { MinifigConfigService } from './config.service';
import { ResearchService } from './research.service';
import { MinifigJobTracker } from './job-tracker';
import { EbayApiAdapter } from '@/lib/ebay/ebay-api.adapter';
import { ebayAuthService } from '@/lib/ebay/ebay-auth.service';
import type { MinifigSyncItem } from './types';

interface RepricingResult {
  jobId: string;
  itemsChecked: number;
  itemsRepriced: number;
  itemsSkipped: number;
  itemsErrored: number;
  errors: Array<{ item?: string; error: string }>;
}

export class RepricingService {
  private configService: MinifigConfigService;
  private researchService: ResearchService;
  private jobTracker: MinifigJobTracker;

  constructor(
    private supabase: SupabaseClient<Database>,
    private userId: string,
  ) {
    this.configService = new MinifigConfigService(supabase);
    this.researchService = new ResearchService(supabase, userId);
    this.jobTracker = new MinifigJobTracker(supabase, userId);
  }

  /**
   * Find stale published listings and reprice them (F65-F66).
   */
  async repriceStaleListings(): Promise<RepricingResult> {
    const jobId = await this.jobTracker.start('REPRICING');
    const errors: Array<{ item?: string; error: string }> = [];
    let itemsChecked = 0;
    let itemsRepriced = 0;
    let itemsSkipped = 0;
    let itemsErrored = 0;

    try {
      const config = await this.configService.getConfig();
      const staleDays = config.reprice_after_days;

      // Find published listings older than reprice_after_days (F65)
      const staleDate = new Date();
      staleDate.setDate(staleDate.getDate() - staleDays);

      // Paginated query for stale items (M1)
      const staleItems: Array<Database['public']['Tables']['minifig_sync_items']['Row']> = [];
      const pageSize = 1000;
      let page = 0;
      let hasMorePages = true;
      while (hasMorePages) {
        const { data } = await this.supabase
          .from('minifig_sync_items')
          .select('*')
          .eq('user_id', this.userId)
          .eq('listing_status', 'PUBLISHED')
          .lt('updated_at', staleDate.toISOString())
          .range(page * pageSize, (page + 1) * pageSize - 1);
        staleItems.push(...(data ?? []));
        hasMorePages = (data?.length ?? 0) === pageSize;
        page++;
      }

      itemsChecked = staleItems.length;

      if (itemsChecked === 0) {
        await this.jobTracker.complete(jobId, {
          itemsProcessed: 0,
          itemsCreated: 0,
          itemsUpdated: 0,
          itemsErrored: 0,
        });
        return { jobId, itemsChecked: 0, itemsRepriced: 0, itemsSkipped: 0, itemsErrored: 0, errors };
      }

      // Get eBay adapter for price updates
      const accessToken = await ebayAuthService.getAccessToken(this.userId);
      if (!accessToken) {
        throw new Error('eBay credentials not configured or token expired');
      }

      const ebayAdapter = new EbayApiAdapter({
        accessToken,
        marketplaceId: 'EBAY_GB',
        userId: this.userId,
      });

      for (const item of staleItems as MinifigSyncItem[]) {
        try {
          // Force-refresh research data (F66)
          await this.researchService.forceRefresh(item.id);

          // Re-fetch the item with updated pricing
          const { data: updatedItem } = await this.supabase
            .from('minifig_sync_items')
            .select('recommended_price, best_offer_auto_accept, best_offer_auto_decline, ebay_offer_id')
            .eq('id', item.id)
            .eq('user_id', this.userId)
            .single();

          if (!updatedItem?.ebay_offer_id || !updatedItem.recommended_price) {
            itemsSkipped++;
            continue;
          }

          const newPrice = Number(updatedItem.recommended_price);
          const oldPrice = Number(item.recommended_price);

          // Only update eBay if price changed
          if (Math.abs(newPrice - oldPrice) > 0.01) {
            try {
              await ebayAdapter.updateOffer(updatedItem.ebay_offer_id, {
                pricingSummary: {
                  price: {
                    value: newPrice.toFixed(2),
                    currency: 'GBP',
                  },
                },
                bestOffer: {
                  bestOfferEnabled: true,
                  autoAcceptPrice: {
                    value: (Number(updatedItem.best_offer_auto_accept) || Math.round(newPrice * 0.95 * 100) / 100).toFixed(2),
                    currency: 'GBP',
                  },
                  autoDeclinePrice: {
                    value: (Number(updatedItem.best_offer_auto_decline) || Math.round(newPrice * 0.75 * 100) / 100).toFixed(2),
                    currency: 'GBP',
                  },
                },
              });
            } catch {
              // Best effort — offer update might fail for ended listings
            }

            itemsRepriced++;
          } else {
            itemsSkipped++;
          }

          // Touch updated_at to reset the stale timer
          await this.supabase
            .from('minifig_sync_items')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', item.id)
            .eq('user_id', this.userId);
        } catch (err) {
          itemsErrored++;
          errors.push({
            item: item.bricklink_id || item.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      await this.jobTracker.complete(jobId, {
        itemsProcessed: itemsChecked,
        itemsCreated: itemsRepriced,
        itemsUpdated: itemsSkipped,
        itemsErrored,
      });

      return { jobId, itemsChecked, itemsRepriced, itemsSkipped, itemsErrored, errors };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push({ error: errorMsg });
      await this.jobTracker.fail(jobId, errors, {
        itemsProcessed: itemsChecked,
        itemsCreated: itemsRepriced,
        itemsUpdated: itemsSkipped,
        itemsErrored,
      });
      throw err;
    }
  }
}

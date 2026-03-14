/**
 * eBay Promoted Listings Service
 *
 * Manages Promoted Listings Standard (CPS) campaigns and ads.
 * Supports viewing promotion status, adding/updating/removing ad rates,
 * and bulk operations with automatic batching (500 per API call).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { EbayApiAdapter } from './ebay-api.adapter';
import { EbayAuthService } from './ebay-auth.service';
import type {
  EbayCampaign,
  EbayAd,
  EbayBulkAdResponseItem,
  EbayFindCampaignResponse,
} from './types';

// ============================================================================
// Types
// ============================================================================

export interface PromotedListingStatus {
  listingId: string;
  isPromoted: boolean;
  campaignId?: string;
  campaignName?: string;
  bidPercentage?: string;
  adId?: string;
  adStatus?: string;
}

export interface BulkPromotionResult {
  successful: EbayBulkAdResponseItem[];
  failed: EbayBulkAdResponseItem[];
  totalRequested: number;
}

const BULK_BATCH_SIZE = 500;

// ============================================================================
// Service
// ============================================================================

export class EbayPromotedListingsService {
  private supabase: SupabaseClient<Database>;
  private userId: string;
  private authService: EbayAuthService;

  constructor(supabase: SupabaseClient<Database>, userId: string, authService?: EbayAuthService) {
    this.supabase = supabase;
    this.userId = userId;
    this.authService = authService ?? new EbayAuthService();
  }

  /**
   * Create an authenticated API adapter
   */
  private async createAdapter(): Promise<EbayApiAdapter> {
    const accessToken = await this.authService.getAccessToken(this.userId);
    if (!accessToken) {
      throw new Error('eBay not connected. Please connect your eBay account first.');
    }
    return new EbayApiAdapter({ accessToken, userId: this.userId });
  }

  // ============================================================================
  // Campaign Methods
  // ============================================================================

  /**
   * Get all CPS (Promoted Listings Standard) campaigns
   */
  async getCampaigns(): Promise<EbayCampaign[]> {
    const adapter = await this.createAdapter();
    const response = await adapter.getCampaigns();
    // Filter to CPS campaigns only
    return (response.campaigns || []).filter(
      (c) => c.fundingStrategy.fundingModel === 'COST_PER_SALE'
    );
  }

  // ============================================================================
  // Promotion Status Methods
  // ============================================================================

  /**
   * Get promotion status for specific listings
   */
  async getPromotionStatus(listingIds: string[]): Promise<PromotedListingStatus[]> {
    const adapter = await this.createAdapter();
    const campaigns = await this.getCampaigns();

    if (campaigns.length === 0) {
      return listingIds.map((id) => ({ listingId: id, isPromoted: false }));
    }

    // For each campaign, fetch ads for the requested listing IDs
    const statusMap = new Map<string, PromotedListingStatus>();

    // Initialise all as not promoted
    for (const id of listingIds) {
      statusMap.set(id, { listingId: id, isPromoted: false });
    }

    for (const campaign of campaigns) {
      if (campaign.campaignStatus !== 'RUNNING') continue;

      // Batch listing IDs into groups for the API (query param has limits)
      for (let i = 0; i < listingIds.length; i += BULK_BATCH_SIZE) {
        const batch = listingIds.slice(i, i + BULK_BATCH_SIZE);
        try {
          const adsResponse = await adapter.getAds(campaign.campaignId, {
            listingIds: batch,
          });

          for (const ad of adsResponse.ads || []) {
            statusMap.set(ad.listingId, {
              listingId: ad.listingId,
              isPromoted: true,
              campaignId: campaign.campaignId,
              campaignName: campaign.campaignName,
              bidPercentage: ad.bidPercentage,
              adId: ad.adId,
              adStatus: ad.adStatus,
            });
          }
        } catch (error) {
          console.error(
            `[EbayPromotedListingsService] Error fetching ads for campaign ${campaign.campaignId}:`,
            error
          );
        }
      }
    }

    return Array.from(statusMap.values());
  }

  /**
   * Get all promoted ads across all running CPS campaigns
   */
  async getAllPromotedAds(): Promise<{ campaign: EbayCampaign; ads: EbayAd[] }[]> {
    const adapter = await this.createAdapter();
    const campaigns = await this.getCampaigns();
    const results: { campaign: EbayCampaign; ads: EbayAd[] }[] = [];

    for (const campaign of campaigns) {
      if (campaign.campaignStatus !== 'RUNNING') continue;

      const allAds: EbayAd[] = [];
      let offset = 0;

      while (true) {
        const response = await adapter.getAds(campaign.campaignId, {
          limit: 500,
          offset,
        });

        allAds.push(...(response.ads || []));

        if (offset + 500 >= response.total) break;
        offset += 500;
      }

      results.push({ campaign, ads: allAds });
    }

    return results;
  }

  /**
   * Find which campaign a specific listing belongs to
   */
  async findCampaignForListing(listingId: string): Promise<EbayFindCampaignResponse> {
    const adapter = await this.createAdapter();
    return adapter.findCampaignByListing(listingId);
  }

  // ============================================================================
  // Add / Update / Remove Methods
  // ============================================================================

  /**
   * Add listings to a campaign with bid percentages.
   * Automatically batches into groups of 500.
   */
  async addListings(
    campaignId: string,
    listings: Array<{ listingId: string; bidPercentage: string }>
  ): Promise<BulkPromotionResult> {
    const adapter = await this.createAdapter();
    const allSuccessful: EbayBulkAdResponseItem[] = [];
    const allFailed: EbayBulkAdResponseItem[] = [];

    for (let i = 0; i < listings.length; i += BULK_BATCH_SIZE) {
      const batch = listings.slice(i, i + BULK_BATCH_SIZE);
      const response = await adapter.bulkCreateAds(campaignId, {
        requests: batch,
      });

      for (const item of response.responses || []) {
        if (item.statusCode >= 200 && item.statusCode < 300) {
          allSuccessful.push(item);
        } else {
          allFailed.push(item);
        }
      }
    }

    return {
      successful: allSuccessful,
      failed: allFailed,
      totalRequested: listings.length,
    };
  }

  /**
   * Update bid percentages for listings in a campaign.
   * Automatically batches into groups of 500.
   */
  async updateBidPercentages(
    campaignId: string,
    listings: Array<{ listingId: string; bidPercentage: string }>
  ): Promise<BulkPromotionResult> {
    const adapter = await this.createAdapter();
    const allSuccessful: EbayBulkAdResponseItem[] = [];
    const allFailed: EbayBulkAdResponseItem[] = [];

    for (let i = 0; i < listings.length; i += BULK_BATCH_SIZE) {
      const batch = listings.slice(i, i + BULK_BATCH_SIZE);
      const response = await adapter.bulkUpdateAdsBid(campaignId, {
        requests: batch,
      });

      for (const item of response.responses || []) {
        if (item.statusCode >= 200 && item.statusCode < 300) {
          allSuccessful.push(item);
        } else {
          allFailed.push(item);
        }
      }
    }

    return {
      successful: allSuccessful,
      failed: allFailed,
      totalRequested: listings.length,
    };
  }

  /**
   * Remove listings from a campaign.
   * Automatically batches into groups of 500.
   */
  async removeListings(
    campaignId: string,
    listingIds: string[]
  ): Promise<BulkPromotionResult> {
    const adapter = await this.createAdapter();
    const allSuccessful: EbayBulkAdResponseItem[] = [];
    const allFailed: EbayBulkAdResponseItem[] = [];

    for (let i = 0; i < listingIds.length; i += BULK_BATCH_SIZE) {
      const batch = listingIds.slice(i, i + BULK_BATCH_SIZE);
      const response = await adapter.bulkDeleteAds(campaignId, {
        requests: batch.map((id) => ({ listingId: id })),
      });

      for (const item of response.responses || []) {
        if (item.statusCode >= 200 && item.statusCode < 300) {
          allSuccessful.push(item);
        } else {
          allFailed.push(item);
        }
      }
    }

    return {
      successful: allSuccessful,
      failed: allFailed,
      totalRequested: listingIds.length,
    };
  }
}

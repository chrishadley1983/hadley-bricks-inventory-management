/**
 * Brickset Set Pricing API Route
 *
 * GET - Fetch pricing data from Amazon, eBay, and BrickLink for a LEGO set
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getEbayBrowseClient } from '@/lib/ebay';
import type { EbayItemSummary } from '@/lib/ebay';
import { BrickLinkClient } from '@/lib/bricklink';
import type { BrickLinkCredentials } from '@/lib/bricklink';
import {
  createAmazonCatalogClient,
  createAmazonPricingClient,
} from '@/lib/amazon';
import type { AmazonCredentials } from '@/lib/amazon';
import { CredentialsRepository } from '@/lib/repositories';
import { BricksetCacheService } from '@/lib/brickset';
import { BricksetCredentialsService } from '@/lib/services';

/**
 * Check if a string is in scientific notation (e.g., "5.70E+12")
 */
function isScientificNotation(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[\d.]+[eE][+-]?\d+$/.test(value);
}

const QuerySchema = z.object({
  setNumber: z.string().min(1, 'Set number is required'),
  ean: z.string().nullable().optional(),
  upc: z.string().nullable().optional(),
});

interface PricingStats {
  minPrice: number | null;
  avgPrice: number | null;
  maxPrice: number | null;
  listingCount: number;
}

interface BrickLinkPricingStats {
  minPrice: number | null;
  avgPrice: number | null;
  maxPrice: number | null;
  lotCount: number;
}

interface AmazonOffer {
  sellerId: string;
  condition: string;
  subCondition: string;
  fulfillmentType: 'AFN' | 'MFN';
  listingPrice: number;
  shippingPrice: number;
  totalPrice: number;
  currency: string;
  isPrime: boolean;
}

interface PricingData {
  amazon: {
    buyBoxPrice: number | null;
    lowestPrice: number | null;
    wasPrice: number | null;
    offerCount: number;
    asin: string | null;
    offers: AmazonOffer[];
  } | null;
  ebay: PricingStats | null;
  ebayUsed: PricingStats | null;
  bricklink: BrickLinkPricingStats | null;
  bricklinkUsed: BrickLinkPricingStats | null;
}

/**
 * GET /api/brickset/pricing
 * Fetch pricing data for a set from multiple platforms
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse query parameters
    const url = new URL(request.url);
    const params = {
      setNumber: url.searchParams.get('setNumber'),
      ean: url.searchParams.get('ean'),
      upc: url.searchParams.get('upc'),
    };

    const parsed = QuerySchema.safeParse(params);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { setNumber, upc } = parsed.data;
    let { ean } = parsed.data;

    // Normalize set number (remove variant suffix for search)
    const baseSetNumber = setNumber.split('-')[0];

    // Check if EAN is in scientific notation (data quality issue)
    // If so, refresh from Brickset API to get the correct value
    if (isScientificNotation(ean)) {
      console.log(`[GET /api/brickset/pricing] EAN "${ean}" is in scientific notation, attempting to get correct EAN from Brickset API`);

      // Try to get Brickset API key and refresh the set data
      const bricksetCredService = new BricksetCredentialsService(supabase);
      const apiKey = await bricksetCredService.getApiKey(user.id);

      if (apiKey) {
        try {
          const cacheService = new BricksetCacheService(supabase);
          const refreshedSet = await cacheService.getSet(setNumber, apiKey, true); // Force refresh

          if (refreshedSet?.ean && !isScientificNotation(refreshedSet.ean)) {
            console.log(`[GET /api/brickset/pricing] Got corrected EAN from Brickset: ${refreshedSet.ean}`);
            ean = refreshedSet.ean;
          } else {
            // Brickset didn't have a valid EAN either, can't recover precision
            console.log(`[GET /api/brickset/pricing] Brickset also has invalid EAN, cannot recover original value`);
            ean = null; // Set to null since we can't recover the correct EAN
          }
        } catch (error) {
          console.error(`[GET /api/brickset/pricing] Failed to refresh from Brickset:`, error);
          // Cannot recover precision from scientific notation, set to null
          ean = null;
        }
      } else {
        // No API key, cannot recover the correct EAN from scientific notation
        console.log(`[GET /api/brickset/pricing] No API key, cannot recover EAN from scientific notation`);
        ean = null;
      }
    }

    // Initialize pricing data
    const pricing: PricingData = {
      amazon: null,
      ebay: null,
      ebayUsed: null,
      bricklink: null,
      bricklinkUsed: null,
    };

    // Create credentials repository
    const credentialsRepo = new CredentialsRepository(supabase);

    // Fetch pricing in parallel (including used conditions)
    const [
      ebayResult,
      ebayUsedResult,
      bricklinkResult,
      bricklinkUsedResult,
      amazonResult,
    ] = await Promise.allSettled([
      // eBay pricing (New)
      fetchEbayPricing(baseSetNumber, 'new'),
      // eBay pricing (Used)
      fetchEbayPricing(baseSetNumber, 'used'),
      // BrickLink pricing (New)
      fetchBricklinkPricing(credentialsRepo, user.id, setNumber, 'N'),
      // BrickLink pricing (Used)
      fetchBricklinkPricing(credentialsRepo, user.id, setNumber, 'U'),
      // Amazon pricing (requires EAN/UPC to find ASIN)
      fetchAmazonPricing(credentialsRepo, user.id, ean || upc || null),
    ]);

    if (ebayResult.status === 'fulfilled') {
      pricing.ebay = ebayResult.value;
    } else {
      console.error('[GET /api/brickset/pricing] eBay error:', ebayResult.reason);
    }

    if (ebayUsedResult.status === 'fulfilled') {
      pricing.ebayUsed = ebayUsedResult.value;
    } else {
      console.error('[GET /api/brickset/pricing] eBay Used error:', ebayUsedResult.reason);
    }

    if (bricklinkResult.status === 'fulfilled') {
      pricing.bricklink = bricklinkResult.value;
    } else {
      console.error('[GET /api/brickset/pricing] BrickLink error:', bricklinkResult.reason);
    }

    if (bricklinkUsedResult.status === 'fulfilled') {
      pricing.bricklinkUsed = bricklinkUsedResult.value;
    } else {
      console.error('[GET /api/brickset/pricing] BrickLink Used error:', bricklinkUsedResult.reason);
    }

    if (amazonResult.status === 'fulfilled') {
      pricing.amazon = amazonResult.value;
    } else {
      console.error('[GET /api/brickset/pricing] Amazon error:', amazonResult.reason);
    }

    return NextResponse.json({ data: pricing });
  } catch (error) {
    console.error('[GET /api/brickset/pricing] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Fetch eBay pricing for a set
 */
async function fetchEbayPricing(
  setNumber: string,
  condition: 'new' | 'used' = 'new'
): Promise<PricingStats | null> {
  console.log(`[fetchEbayPricing] Fetching ${condition} condition for set ${setNumber}`);

  try {
    const ebayClient = getEbayBrowseClient();
    const results = condition === 'used'
      ? await ebayClient.searchLegoSetUsed(setNumber, 50)
      : await ebayClient.searchLegoSet(setNumber, 50);

    console.log(`[fetchEbayPricing] ${condition} - Got ${results.itemSummaries?.length ?? 0} results, total: ${results.total}`);

    if (!results.itemSummaries || results.itemSummaries.length === 0) {
      return {
        minPrice: null,
        avgPrice: null,
        maxPrice: null,
        listingCount: 0,
      };
    }

    // Calculate min, avg, max from listings
    const prices = results.itemSummaries
      .map((item: EbayItemSummary) => {
        const price = parseFloat(item.price?.value || '0');
        const shipping = parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || '0');
        return price + shipping;
      })
      .filter((p: number) => p > 0);

    if (prices.length === 0) {
      return {
        minPrice: null,
        avgPrice: null,
        maxPrice: null,
        listingCount: 0,
      };
    }

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;

    return {
      minPrice,
      avgPrice: Math.round(avgPrice * 100) / 100,
      maxPrice,
      listingCount: prices.length,
    };
  } catch (error) {
    console.error('[fetchEbayPricing] Error:', error);
    return null;
  }
}

/**
 * Fetch BrickLink pricing for a set
 */
async function fetchBricklinkPricing(
  credentialsRepo: CredentialsRepository,
  userId: string,
  setNumber: string,
  condition: 'N' | 'U' = 'N'
): Promise<BrickLinkPricingStats | null> {
  console.log(`[fetchBricklinkPricing] Fetching ${condition} condition for set ${setNumber}`);

  try {
    // Get BrickLink credentials
    const credentials = await credentialsRepo.getCredentials<BrickLinkCredentials>(
      userId,
      'bricklink'
    );

    if (!credentials) {
      console.log('[fetchBricklinkPricing] No BrickLink credentials found');
      return null;
    }

    const blClient = new BrickLinkClient(credentials);

    // Get price guide for specified condition in UK
    const priceGuide = await blClient.getSetPriceGuide(setNumber, {
      condition,
      countryCode: 'UK',
      currencyCode: 'GBP',
    });

    console.log(`[fetchBricklinkPricing] ${condition} response:`, JSON.stringify({
      min_price: priceGuide.min_price,
      avg_price: priceGuide.avg_price,
      max_price: priceGuide.max_price,
      unit_quantity: priceGuide.unit_quantity,
    }));

    // BrickLink API returns prices as strings, need to parse them
    const minPrice = priceGuide.min_price ? parseFloat(priceGuide.min_price) : null;
    const avgPrice = priceGuide.avg_price ? parseFloat(priceGuide.avg_price) : null;
    const maxPrice = priceGuide.max_price ? parseFloat(priceGuide.max_price) : null;

    return {
      minPrice: minPrice !== null && !isNaN(minPrice) ? minPrice : null,
      avgPrice: avgPrice !== null && !isNaN(avgPrice) ? avgPrice : null,
      maxPrice: maxPrice !== null && !isNaN(maxPrice) ? maxPrice : null,
      lotCount: priceGuide.unit_quantity || 0,
    };
  } catch (error) {
    console.error(`[fetchBricklinkPricing] Error for ${condition}:`, error);
    return null;
  }
}

/**
 * Fetch Amazon pricing for a set (requires EAN/UPC to find ASIN)
 */
async function fetchAmazonPricing(
  credentialsRepo: CredentialsRepository,
  userId: string,
  identifier: string | null
): Promise<PricingData['amazon']> {
  if (!identifier) {
    return null;
  }

  try {
    // Get Amazon credentials
    const credentials = await credentialsRepo.getCredentials<AmazonCredentials>(
      userId,
      'amazon'
    );

    if (!credentials) {
      return null;
    }

    // First, find the ASIN using the catalog API
    const catalogClient = createAmazonCatalogClient(credentials);
    const identifierType = identifier.length === 13 ? 'EAN' : 'UPC';
    const catalogResult = await catalogClient.searchCatalogByIdentifier(
      identifier,
      identifierType
    );

    if (!catalogResult.items || catalogResult.items.length === 0) {
      return {
        buyBoxPrice: null,
        lowestPrice: null,
        wasPrice: null,
        offerCount: 0,
        asin: null,
        offers: [],
      };
    }

    const asin = catalogResult.items[0].asin;

    // Now get competitive pricing
    const pricingClient = createAmazonPricingClient(credentials);
    const pricingData = await pricingClient.getCompetitiveSummary([asin]);

    if (!pricingData || pricingData.length === 0) {
      return {
        buyBoxPrice: null,
        lowestPrice: null,
        wasPrice: null,
        offerCount: 0,
        asin,
        offers: [],
      };
    }

    const pricing = pricingData[0];

    // Transform offers to our interface
    const offers: AmazonOffer[] = pricing.offers.map((offer) => ({
      sellerId: offer.sellerId,
      condition: offer.condition,
      subCondition: offer.subCondition,
      fulfillmentType: offer.fulfillmentType,
      listingPrice: offer.listingPrice,
      shippingPrice: offer.shippingPrice,
      totalPrice: offer.totalPrice,
      currency: offer.currency,
      isPrime: offer.isPrime,
    }));

    return {
      buyBoxPrice: pricing.competitivePrice || null,
      lowestPrice: pricing.lowestOffer?.totalPrice || null,
      wasPrice: pricing.wasPrice || null,
      offerCount: pricing.totalOfferCount || 0,
      asin,
      offers,
    };
  } catch (error) {
    console.error('[fetchAmazonPricing] Error:', error);
    return null;
  }
}

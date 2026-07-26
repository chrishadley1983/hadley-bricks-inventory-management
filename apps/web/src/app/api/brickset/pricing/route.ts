/**
 * Brickset Set Pricing API Route
 *
 * GET - Fetch pricing data from Amazon, eBay, and BrickLink for a LEGO set
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { getEbayBrowseClient } from '@/lib/ebay';
import { isValidLegoListing } from '@/lib/arbitrage/ebay-listing-validator';
import type { EbayItemSummary } from '@/lib/ebay';
import { BrickLinkClient, BrickLinkApiError, RateLimitError } from '@/lib/bricklink';
import type { BrickLinkCredentials } from '@/lib/bricklink';
import { ensurePriceGuide } from '@/lib/bricklink/price-guide/capture';
import type { MonthlySold } from '@/lib/bricklink/price-guide/read';
import { createAmazonCatalogClient, createAmazonPricingClient } from '@/lib/amazon';
import { pickBestAsin, type AsinCandidate } from '@/lib/amazon/asin-resolution';
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

/** UK price-guide cache freshness for the pricing panel (days). */
const BRICKSET_PRICING_TTL_DAYS = 7;

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

/**
 * Why this carries a `status` rather than just going null on failure:
 *
 * every BrickLink failure — missing credentials, a rejected key, an outage — used to
 * return `null`, which renders identically to "this set genuinely has no BrickLink
 * listings". The panel looked like data, and was actually an error. The status is the
 * discriminator; `message` carries the detail when there is one.
 */
type BrickLinkPanelStatus = 'ok' | 'not-configured' | 'error' | 'no-data';

interface BrickLinkPricingStats {
  status: BrickLinkPanelStatus;
  message: string | null;
  minPrice: number | null;
  avgPrice: number | null;
  maxPrice: number | null;
  lotCount: number;
  /** Sold-side context, so the drill-down can show what backs the asking prices. */
  soldAvg: number | null;
  soldMedian: number | null;
  soldLots: number;
  soldQty: number;
  /** Quantity-basis sell-through (the house definition), 0..n. */
  strQty: number | null;
  /** Months BL had UK sold rows for — sparse and NOT gap-filled. See SideView.byMonth. */
  byMonth: Record<string, MonthlySold> | null;
  /** How fresh the cached price row is, in days. */
  freshnessDays: number | null;
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
 * Panel payload for the case where the BrickLink fetch itself rejected. fetchBricklinkPricing
 * catches its own errors, so reaching here is a bug — the reason is logged, not returned.
 */
function bricklinkPanelError(): BrickLinkPricingStats {
  return {
    status: 'error',
    message: 'BrickLink price lookup failed. See the server log for detail.',
    minPrice: null,
    avgPrice: null,
    maxPrice: null,
    lotCount: 0,
    soldAvg: null,
    soldMedian: null,
    soldLots: 0,
    soldQty: 0,
    strQty: null,
    byMonth: null,
    freshnessDays: null,
  };
}

/**
 * GET /api/brickset/pricing
 * Fetch pricing data for a set from multiple platforms
 */
export async function GET(request: NextRequest) {
  try {
    // Validate auth via API key or session cookie
    const auth = await validateAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service role client for API key auth (bypasses RLS)
    const isApiKeyAuth = !!request.headers.get('x-api-key');
    const supabase = isApiKeyAuth ? createServiceRoleClient() : await createClient();
    const userId = auth.userId;

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
      console.log(
        `[GET /api/brickset/pricing] EAN "${ean}" is in scientific notation, attempting to get correct EAN from Brickset API`
      );

      // Try to get Brickset API key and refresh the set data
      const bricksetCredService = new BricksetCredentialsService(supabase);
      const apiKey = await bricksetCredService.getApiKey(userId);

      if (apiKey) {
        try {
          const cacheService = new BricksetCacheService(supabase);
          const refreshedSet = await cacheService.getSet(setNumber, apiKey, true); // Force refresh

          if (refreshedSet?.ean && !isScientificNotation(refreshedSet.ean)) {
            console.log(
              `[GET /api/brickset/pricing] Got corrected EAN from Brickset: ${refreshedSet.ean}`
            );
            ean = refreshedSet.ean;
          } else {
            // Brickset didn't have a valid EAN either, can't recover precision
            console.log(
              `[GET /api/brickset/pricing] Brickset also has invalid EAN, cannot recover original value`
            );
            ean = null; // Set to null since we can't recover the correct EAN
          }
        } catch (error) {
          console.error(`[GET /api/brickset/pricing] Failed to refresh from Brickset:`, error);
          // Cannot recover precision from scientific notation, set to null
          ean = null;
        }
      } else {
        // No API key, cannot recover the correct EAN from scientific notation
        console.log(
          `[GET /api/brickset/pricing] No API key, cannot recover EAN from scientific notation`
        );
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
    const [ebayResult, ebayUsedResult, bricklinkResult, bricklinkUsedResult, amazonResult] =
      await Promise.allSettled([
        // eBay pricing (New)
        fetchEbayPricing(baseSetNumber, 'new'),
        // eBay pricing (Used)
        fetchEbayPricing(baseSetNumber, 'used'),
        // BrickLink pricing (New)
        fetchBricklinkPricing(credentialsRepo, supabase, userId, setNumber, 'N'),
        // BrickLink pricing (Used)
        fetchBricklinkPricing(credentialsRepo, supabase, userId, setNumber, 'U'),
        // Amazon pricing (requires EAN/UPC to find ASIN)
        fetchAmazonPricing(credentialsRepo, supabase, userId, setNumber, ean, upc),
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

    // A rejected promise here is a bug in fetchBricklinkPricing (it catches its own
    // errors), but don't let it degrade to an indistinguishable null — say so.
    if (bricklinkResult.status === 'fulfilled') {
      pricing.bricklink = bricklinkResult.value;
    } else {
      console.error('[GET /api/brickset/pricing] BrickLink error:', bricklinkResult.reason);
      pricing.bricklink = bricklinkPanelError();
    }

    if (bricklinkUsedResult.status === 'fulfilled') {
      pricing.bricklinkUsed = bricklinkUsedResult.value;
    } else {
      console.error(
        '[GET /api/brickset/pricing] BrickLink Used error:',
        bricklinkUsedResult.reason
      );
      pricing.bricklinkUsed = bricklinkPanelError();
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

  const empty: PricingStats = {
    minPrice: null,
    avgPrice: null,
    maxPrice: null,
    listingCount: 0,
  };

  try {
    const ebayClient = getEbayBrowseClient();
    const results =
      condition === 'used'
        // sortByPrice=false: an average must not be taken from the 50 cheapest.
        ? await ebayClient.searchLegoSetUsed(setNumber, 50, false)
        : await ebayClient.searchLegoSet(setNumber, 50, false);

    if (!results.itemSummaries || results.itemSummaries.length === 0) return empty;

    // Category 19006 is NOT sufficient on its own — sellers miscategorise, which is why
    // a weekly audit job exists for our own listings. Title-filter what comes back.
    const kept: EbayItemSummary[] = [];
    const rejected: string[] = [];
    for (const item of results.itemSummaries) {
      // requireSetNumber: a price average needs precision over recall — see the option's note.
      if (isValidLegoListing(item.title ?? '', setNumber, { requireSetNumber: true })) kept.push(item);
      else rejected.push(item.title ?? '(untitled)');
    }

    const prices = kept
      .map((item: EbayItemSummary) => {
        const price = parseFloat(item.price?.value || '0');
        const shipping = parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || '0');
        return price + shipping;
      })
      .filter((p: number) => p > 0)
      .sort((a, b) => a - b);

    console.log(
      `[fetchEbayPricing] ${condition} ${setNumber}: ${results.itemSummaries.length} returned, ` +
        `${rejected.length} rejected by title, ${prices.length} priced` +
        (rejected.length ? ` — e.g. "${rejected.slice(0, 3).join('" | "')}"` : '')
    );

    if (prices.length === 0) return empty;

    // MEDIAN, not mean. Even after filtering, one survivor priced as a part or a
    // mispriced listing drags a mean a long way; the median of the kept set is what a
    // typical listing actually asks.
    const mid = Math.floor(prices.length / 2);
    const median =
      prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];

    return {
      minPrice: prices[0],
      avgPrice: Math.round(median * 100) / 100,
      maxPrice: prices[prices.length - 1],
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
  supabase: SupabaseClient<Database>,
  userId: string,
  setNumber: string,
  condition: 'N' | 'U' = 'N'
): Promise<BrickLinkPricingStats> {
  console.log(`[fetchBricklinkPricing] Fetching ${condition} condition for set ${setNumber}`);

  const empty = (
    status: BrickLinkPanelStatus,
    message: string | null = null
  ): BrickLinkPricingStats => ({
    status,
    message,
    minPrice: null,
    avgPrice: null,
    maxPrice: null,
    lotCount: 0,
    soldAvg: null,
    soldMedian: null,
    soldLots: 0,
    soldQty: 0,
    strQty: null,
    byMonth: null,
    freshnessDays: null,
  });

  try {
    // Get BrickLink credentials
    const credentials = await credentialsRepo.getCredentials<BrickLinkCredentials>(
      userId,
      'bricklink'
    );

    if (!credentials) {
      console.log('[fetchBricklinkPricing] No BrickLink credentials found');
      return empty('not-configured', 'BrickLink is not connected. Add credentials in Settings.');
    }

    const blClient = new BrickLinkClient(credentials, {
      supabase,
      caller: 'brickset-pricing',
    });

    // Unified price cache: serves from a fresh UK row when available, otherwise
    // fetches + captures all four quadrants (so this lookup warms the shared cache)
    const view = await ensurePriceGuide(
      blClient,
      supabase,
      { itemType: 'S', itemNo: setNumber, colourId: 0 },
      { ttlDays: BRICKSET_PRICING_TTL_DAYS }
    );

    const side = condition === 'N' ? view.new : view.used;
    console.log(
      `[fetchBricklinkPricing] ${condition} view:`,
      JSON.stringify({
        stockMin: side.stockMin,
        stockAvg: side.stockAvg,
        stockMax: side.stockMax,
        stockLots: side.stockLots,
        coverage: view.coverage,
      })
    );

    const hasAnything =
      side.stockLots > 0 || side.soldLots > 0 || side.stockMin != null || side.soldAvg != null;

    return {
      status: hasAnything ? 'ok' : 'no-data',
      message: hasAnything
        ? null
        : 'BrickLink has no UK listings or sales on record for this set/condition.',
      minPrice: side.stockMin,
      avgPrice: side.stockAvg ?? side.soldAvg,
      maxPrice: side.stockMax,
      lotCount: side.stockLots,
      soldAvg: side.soldAvg,
      soldMedian: side.soldMedian,
      soldLots: side.soldLots,
      soldQty: side.soldQty,
      strQty: side.strQty,
      byMonth: side.byMonth ?? null,
      freshnessDays: view.freshnessDays,
    };
  } catch (error) {
    console.error(`[fetchBricklinkPricing] Error for ${condition}:`, error);
    // Only BrickLink's own error text reaches the client. Any other message (Supabase
    // internals, network detail) stays in the server log — the panel needs to say
    // "this failed", not leak how.
    return empty('error', blClientMessage(error));
  }
}

/** Client-safe failure text: BrickLink's own error, else a generic line. */
function blClientMessage(error: unknown): string {
  if (error instanceof RateLimitError) {
    return 'BrickLink rate limit hit. Try again shortly.';
  }
  if (error instanceof BrickLinkApiError) {
    return `BrickLink API error (${error.code}): ${error.message}`;
  }
  return 'BrickLink price lookup failed. See the server log for detail.';
}

/**
 * Fetch Amazon pricing for a set (requires EAN/UPC to find ASIN)
 */
async function fetchAmazonPricing(
  credentialsRepo: CredentialsRepository,
  supabase: SupabaseClient<Database>,
  userId: string,
  setNumber: string,
  ean: string | null | undefined,
  upc: string | null | undefined
): Promise<PricingData['amazon']> {
  const empty = (asin: string | null = null): PricingData['amazon'] => ({
    buyBoxPrice: null,
    lowestPrice: null,
    wasPrice: null,
    offerCount: 0,
    asin,
    offers: [],
  });

  try {
    const credentials = await credentialsRepo.getCredentials<AmazonCredentials>(userId, 'amazon');
    if (!credentials) return null;

    const candidates: AsinCandidate[] = [];

    // 1. Curated seed. Keyed by brickset_sets.id, not the set number.
    const { data: bricksetRow } = await supabase
      .from('brickset_sets')
      .select('id')
      .eq('set_number', setNumber)
      .maybeSingle();

    if (bricksetRow?.id) {
      const { data: seeded } = await supabase
        .from('seeded_asins')
        .select('asin, amazon_title')
        .eq('brickset_set_id', bricksetRow.id)
        .maybeSingle();
      if (seeded?.asin) {
        candidates.push({
          asin: seeded.asin as string,
          title: (seeded.amazon_title as string | null) ?? null,
          source: 'seeded',
        });
      }
    }

    // 2. Catalogue search by EAN then UPC. Both are tried because they surface
    //    DIFFERENT ASINs for the same set.
    const catalogClient = createAmazonCatalogClient(credentials);
    for (const identifier of [ean, upc].filter((v): v is string => !!v)) {
      try {
        const result = await catalogClient.searchCatalogByIdentifier(
          identifier,
          identifier.length === 13 ? 'EAN' : 'UPC'
        );
        for (const item of result.items ?? []) {
          if (item.asin && !candidates.some((c) => c.asin === item.asin)) {
            candidates.push({ asin: item.asin, title: item.title ?? null, source: 'catalog' });
          }
        }
      } catch (error) {
        console.error(`[fetchAmazonPricing] Catalogue lookup failed for ${identifier}:`, error);
      }
    }

    const choice = pickBestAsin(candidates, setNumber);
    console.log(
      `[fetchAmazonPricing] ${setNumber}: ${candidates.length} candidate(s) -> ${choice.asin ?? 'none'} (${choice.reason})`
    );
    if (!choice.asin) return empty();

    // 3. Buy Box via the SAME call the buy-box cron uses. getCompetitiveSummary's
    //    `competitivePrice` comes back null even when a Buy Box demonstrably exists;
    //    getCompetitivePricing resolves it from CompetitivePriceId === '1'.
    const pricingClient = createAmazonPricingClient(credentials);
    const [competitive, summary] = await Promise.all([
      pricingClient.getCompetitivePricing([choice.asin]).catch((e) => {
        console.error('[fetchAmazonPricing] getCompetitivePricing failed:', e);
        return [];
      }),
      pricingClient.getCompetitiveSummary([choice.asin]).catch((e) => {
        console.error('[fetchAmazonPricing] getCompetitiveSummary failed:', e);
        return [];
      }),
    ]);

    const pricing = summary[0];
    const offers: AmazonOffer[] = (pricing?.offers ?? []).map((offer) => ({
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
      buyBoxPrice: competitive[0]?.buyBoxPrice ?? null,
      lowestPrice: pricing?.lowestOffer?.totalPrice ?? null,
      wasPrice: pricing?.wasPrice ?? null,
      offerCount: pricing?.totalOfferCount ?? 0,
      asin: choice.asin,
      offers,
    };
  } catch (error) {
    console.error('[fetchAmazonPricing] Error:', error);
    return null;
  }
}

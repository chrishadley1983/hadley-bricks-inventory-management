/**
 * eBay Listings API Route for Set Lookup
 *
 * GET - Fetch eBay listings for a LEGO set (returns full listing details)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getEbayBrowseClient } from '@/lib/ebay';
import type { EbayItemSummary } from '@/lib/ebay';

const QuerySchema = z.object({
  setNumber: z.string().min(1, 'Set number is required'),
  condition: z.enum(['new', 'used']).default('new'),
});

export interface EbayListingItem {
  itemId: string;
  title: string;
  price: number;
  shippingCost: number;
  totalPrice: number;
  currency: string;
  condition: string | null;
  seller: string;
  sellerFeedback: number;
  sellerFeedbackScore: number;
  url: string;
  imageUrl: string | null;
  location: string | null;
}

export interface EbayListingsResponse {
  listings: EbayListingItem[];
  stats: {
    minPrice: number | null;
    avgPrice: number | null;
    maxPrice: number | null;
    listingCount: number;
  };
  setNumber: string;
  condition: 'new' | 'used';
  searchedAt: string;
}

/**
 * GET /api/brickset/ebay-listings
 * Fetch eBay listings for a set with full details
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
      condition: url.searchParams.get('condition') || 'new',
    };

    const parsed = QuerySchema.safeParse(params);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { setNumber, condition } = parsed.data;

    // Normalize set number (remove variant suffix for search)
    const baseSetNumber = setNumber.split('-')[0];

    console.log(`[GET /api/brickset/ebay-listings] Searching for ${condition} set: ${baseSetNumber}`);

    // Fetch eBay listings based on condition
    const ebayClient = getEbayBrowseClient();
    const results = condition === 'used'
      ? await ebayClient.searchLegoSetUsed(baseSetNumber, 50)
      : await ebayClient.searchLegoSet(baseSetNumber, 50);

    if (!results.itemSummaries || results.itemSummaries.length === 0) {
      return NextResponse.json({
        data: {
          listings: [],
          stats: {
            minPrice: null,
            avgPrice: null,
            maxPrice: null,
            listingCount: 0,
          },
          setNumber,
          condition,
          searchedAt: new Date().toISOString(),
        } as EbayListingsResponse,
      });
    }

    // Transform listings to our format
    const listings: EbayListingItem[] = results.itemSummaries.map((item: EbayItemSummary) => {
      const price = parseFloat(item.price?.value || '0');
      const shippingCost = parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || '0');
      const totalPrice = price + shippingCost;

      return {
        itemId: item.itemId,
        title: item.title,
        price,
        shippingCost,
        totalPrice,
        currency: item.price?.currency || 'GBP',
        condition: item.condition || null,
        seller: item.seller?.username || 'Unknown',
        sellerFeedback: parseFloat(item.seller?.feedbackPercentage || '0'),
        sellerFeedbackScore: item.seller?.feedbackScore || 0,
        url: item.itemWebUrl || `https://www.ebay.co.uk/itm/${item.itemId}`,
        imageUrl: item.image?.imageUrl || null,
        location: item.itemLocation?.country || null,
      };
    });

    // Sort by totalPrice ascending
    listings.sort((a, b) => a.totalPrice - b.totalPrice);

    // Calculate stats
    const prices = listings.map((l) => l.totalPrice).filter((p) => p > 0);
    const stats = {
      minPrice: prices.length > 0 ? Math.min(...prices) : null,
      avgPrice: prices.length > 0 ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 : null,
      maxPrice: prices.length > 0 ? Math.max(...prices) : null,
      listingCount: prices.length,
    };

    console.log(`[GET /api/brickset/ebay-listings] Found ${listings.length} listings for set ${baseSetNumber}`);

    return NextResponse.json({
      data: {
        listings,
        stats,
        setNumber,
        condition,
        searchedAt: new Date().toISOString(),
      } as EbayListingsResponse,
    });
  } catch (error) {
    console.error('[GET /api/brickset/ebay-listings] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

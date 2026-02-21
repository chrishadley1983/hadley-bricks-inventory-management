/**
 * Vinted LEGO Arbitrage API
 *
 * Fetches Vinted listings and compares to Amazon pricing for arbitrage opportunities.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AmazonPricingClient } from '@/lib/amazon/amazon-pricing.client';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import type { AmazonCredentials } from '@/lib/amazon/types';

const VINTED_SHIPPING_COST = 2.3;
const DEFAULT_COG_THRESHOLD = 40;

interface VintedListing {
  title: string;
  price: number;
  setNumber: string | null;
  totalCost: number;
  url?: string;
}

interface ArbitrageResult {
  setNumber: string;
  title: string;
  vintedPrice: number;
  totalCost: number;
  amazonPrice: number | null;
  amazonBuyBox: number | null;
  amazonWasPrice: number | null;
  cogPercent: number | null;
  profit: number | null;
  roi: number | null;
  viable: boolean;
  asin: string | null;
  vintedUrl?: string;
}

/**
 * Extract LEGO set number from listing title
 */
function extractSetNumber(title: string): string | null {
  if (!title) return null;

  const lowerTitle = title.toLowerCase();
  // Skip non-LEGO items
  if (
    lowerTitle.includes('compatible') ||
    lowerTitle.includes('moc ') ||
    lowerTitle.includes('custom') ||
    lowerTitle.includes('block tech')
  ) {
    return null;
  }

  // Common patterns for LEGO set numbers
  const patterns = [
    /\b(\d{4,5})\b/, // 4-5 digit numbers
    /set[:\s-]*(\d{4,5})/i, // "Set 12345"
    /lego[:\s-]*(\d{4,5})/i, // "LEGO 12345"
    /#(\d{4,5})/, // "#12345"
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      const num = parseInt(match[1]);
      if (num >= 1000 && num <= 99999) {
        return match[1];
      }
    }
  }

  return null;
}

/**
 * Parse Vinted HTML and extract listings
 */
function parseVintedListings(html: string): VintedListing[] {
  const listings: VintedListing[] = [];

  // Match listing blocks - look for the anchor tag with href and the img alt text
  // Pattern: href="/items/[id]-[slug]" ... alt="[title], brand: LEGO, condition: New with tags, size: [size], £[price]"
  // We need to capture both the URL and the listing details
  const listingBlockPattern =
    /<a[^>]*href="(\/items\/\d+-[^"]+)"[^>]*>[\s\S]*?alt="([^"]+),\s*brand:\s*LEGO[^,]*,\s*condition:\s*New with tags[^,]*(?:,\s*size:\s*[^,]+)?,\s*£([\d.]+)/gi;

  let match;
  while ((match = listingBlockPattern.exec(html)) !== null) {
    const [, urlPath, title, price] = match;
    const setNumber = extractSetNumber(title);

    listings.push({
      title: title.trim(),
      price: parseFloat(price),
      setNumber,
      totalCost: parseFloat(price) + VINTED_SHIPPING_COST,
      url: `https://www.vinted.co.uk${urlPath}`,
    });
  }

  // Fallback: if no matches with URL, try the original pattern without URL
  if (listings.length === 0) {
    const fallbackPattern =
      /alt="([^"]+),\s*brand:\s*LEGO[^,]*,\s*condition:\s*New with tags[^,]*(?:,\s*size:\s*[^,]+)?,\s*£([\d.]+)/gi;

    while ((match = fallbackPattern.exec(html)) !== null) {
      const [, title, price] = match;
      const setNumber = extractSetNumber(title);

      listings.push({
        title: title.trim(),
        price: parseFloat(price),
        setNumber,
        totalCost: parseFloat(price) + VINTED_SHIPPING_COST,
      });
    }
  }

  return listings;
}

/**
 * GET /api/arbitrage/vinted
 *
 * Query params:
 * - url: Vinted catalog URL to scan
 * - cogThreshold: COG% threshold (default 40)
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const vintedUrl = searchParams.get('url');
  const cogThreshold = parseFloat(
    searchParams.get('cogThreshold') || String(DEFAULT_COG_THRESHOLD)
  );

  if (!vintedUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  try {
    // Fetch Vinted page
    const response = await fetch(vintedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `Failed to fetch Vinted page: ${response.status}`,
        },
        { status: 502 }
      );
    }

    const html = await response.text();
    const listings = parseVintedListings(html);

    // Filter to listings with identifiable set numbers
    const identifiableListings = listings.filter((l) => l.setNumber);
    const uniqueSetNumbers = [...new Set(identifiableListings.map((l) => l.setNumber!))];

    // Look up ASINs for these set numbers from seeded_asins
    const { data: seededAsins } = await supabase
      .from('seeded_asins')
      .select(
        `
        asin,
        brickset_sets!inner (
          set_number,
          set_name,
          uk_retail_price
        )
      `
      )
      .in(
        'brickset_sets.set_number',
        uniqueSetNumbers.map((s) => `${s}-1`)
      )
      .eq('discovery_status', 'found');

    // Build set number -> ASIN map
    const setToAsin = new Map<string, string>();
    const setToRRP = new Map<string, number>();

    interface SeededAsinRow {
      asin: string | null;
      brickset_sets: {
        set_number: string;
        set_name: string;
        uk_retail_price: number | null;
      };
    }

    (seededAsins as SeededAsinRow[] | null)?.forEach((sa) => {
      const setNum = sa.brickset_sets.set_number.replace('-1', '');
      if (sa.asin) setToAsin.set(setNum, sa.asin);
      if (sa.brickset_sets.uk_retail_price) {
        setToRRP.set(setNum, sa.brickset_sets.uk_retail_price);
      }
    });

    // Get Amazon pricing for ASINs we found
    const asins = [...setToAsin.values()];
    const amazonPricing = new Map<string, { buyBox: number | null; wasPrice: number | null }>();

    if (asins.length > 0) {
      // Get user's Amazon credentials
      const credentialsRepo = new CredentialsRepository(supabase);
      const credentials = await credentialsRepo.getCredentials<AmazonCredentials>(
        user.id,
        'amazon'
      );

      if (credentials) {
        const amazonClient = new AmazonPricingClient(credentials);

        // Fetch competitive pricing for ASINs
        const pricingData = await amazonClient.getCompetitivePricing(asins);

        pricingData.forEach((pricing) => {
          amazonPricing.set(pricing.asin, {
            buyBox: pricing.buyBoxPrice,
            wasPrice: null, // Standard competitive pricing doesn't include Was Price
          });
        });

        // Try to get WasPrice from competitive summary if available (slower API)
        // Only fetch for items that don't have pricing yet
        try {
          const summaryData = await amazonClient.getCompetitiveSummary(asins.slice(0, 20)); // Limit to 20 for rate limiting
          summaryData.forEach((summary) => {
            const existing = amazonPricing.get(summary.asin);
            if (existing) {
              existing.wasPrice = summary.wasPrice;
            } else {
              amazonPricing.set(summary.asin, {
                buyBox: summary.lowestOffer?.totalPrice ?? null,
                wasPrice: summary.wasPrice,
              });
            }
          });
        } catch (err) {
          // Competitive summary may not be available, continue without Was Price
          console.warn('Could not fetch competitive summary:', err);
        }
      }
    }

    // Calculate arbitrage for each listing
    const results: ArbitrageResult[] = [];

    for (const listing of identifiableListings) {
      const asin = setToAsin.get(listing.setNumber!);
      const rrp = setToRRP.get(listing.setNumber!);
      const pricing = asin ? amazonPricing.get(asin) : null;

      // Use Buy Box price, or fall back to RRP
      const amazonPrice = pricing?.buyBox || rrp || null;

      let cogPercent: number | null = null;
      let profit: number | null = null;
      let roi: number | null = null;

      if (amazonPrice) {
        cogPercent = (listing.totalCost / amazonPrice) * 100;
        const amazonFees = amazonPrice * 0.1836; // ~18.36% effective FBM fees
        profit = amazonPrice - amazonFees - listing.totalCost;
        roi = (profit / listing.totalCost) * 100;
      }

      results.push({
        setNumber: listing.setNumber!,
        title: listing.title,
        vintedPrice: listing.price,
        totalCost: listing.totalCost,
        amazonPrice,
        amazonBuyBox: pricing?.buyBox || null,
        amazonWasPrice: pricing?.wasPrice || null,
        cogPercent: cogPercent ? Math.round(cogPercent * 10) / 10 : null,
        profit: profit ? Math.round(profit * 100) / 100 : null,
        roi: roi ? Math.round(roi * 10) / 10 : null,
        viable: cogPercent !== null && cogPercent <= cogThreshold,
        asin: asin || null,
        vintedUrl: listing.url,
      });
    }

    // Sort by COG% (lowest first)
    results.sort((a, b) => {
      if (a.cogPercent === null) return 1;
      if (b.cogPercent === null) return -1;
      return a.cogPercent - b.cogPercent;
    });

    // Summary
    const viable = results.filter((r) => r.viable);
    const withPricing = results.filter((r) => r.amazonPrice !== null);

    return NextResponse.json({
      summary: {
        totalListings: listings.length,
        identifiedSets: identifiableListings.length,
        uniqueSets: uniqueSetNumbers.length,
        withAmazonPricing: withPricing.length,
        viableOpportunities: viable.length,
        cogThreshold,
      },
      results,
      viable,
    });
  } catch (error) {
    console.error('Vinted arbitrage error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/arbitrage/vinted
 *
 * Body:
 * - html: Raw HTML from Vinted page
 * - cogThreshold: COG% threshold (default 40)
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { html, cogThreshold = DEFAULT_COG_THRESHOLD } = body;

  if (!html) {
    return NextResponse.json({ error: 'Missing html in request body' }, { status: 400 });
  }

  // Parse listings from provided HTML
  const listings = parseVintedListings(html);
  const identifiableListings = listings.filter((l) => l.setNumber);
  const uniqueSetNumbers = [...new Set(identifiableListings.map((l) => l.setNumber!))];

  return NextResponse.json({
    summary: {
      totalListings: listings.length,
      identifiedSets: identifiableListings.length,
      uniqueSets: uniqueSetNumbers.length,
      cogThreshold,
    },
    setNumbers: uniqueSetNumbers,
    listings: identifiableListings,
  });
}

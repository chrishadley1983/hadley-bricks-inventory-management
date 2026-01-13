/**
 * Debug endpoint to call Amazon SP-API getCompetitiveSummary for a specific ASIN
 *
 * Uses Product Pricing API v2022-05-01 which includes:
 * - WasPrice (90-day median price customers pay)
 * - Featured offer expected price
 * - Competitive pricing threshold
 *
 * Rate limit: 0.033 req/sec (getCompetitiveSummary batch)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { AmazonCredentials } from '@/lib/amazon/types';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';

/** LWA token endpoint for OAuth refresh */
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

/** EU SP-API endpoint */
const EU_ENDPOINT = 'https://sellingpartnerapi-eu.amazon.com';

/** UK Marketplace ID */
const UK_MARKETPLACE_ID = 'A1F83G8C2ARO7P';

/** Money amount type */
interface MoneyType {
  currencyCode: string;
  amount: number;
}

/** Reference price (includes WasPrice) */
interface ReferencePrice {
  referencePriceId: string;
  price?: MoneyType;
  condition?: string;
}

/** Featured offer */
interface FeaturedOffer {
  offerType?: string;
  condition?: string;
  listingPrice?: MoneyType;
  shippingPrice?: MoneyType;
  points?: { pointsNumber: number };
}

/** Competitive summary response item */
interface CompetitiveSummaryResponseItem {
  asin: string;
  marketplaceId: string;
  status: {
    statusCode: number;
    reasonPhrase?: string;
  };
  body?: {
    asin: string;
    marketplaceId: string;
    featuredBuyingOptions?: Array<{
      buyingOptionType: string;
      segmentedFeaturedOffers?: Array<{
        customerMembership?: string;
        featuredOffer?: FeaturedOffer;
      }>;
    }>;
    referencePrices?: ReferencePrice[];
    lowestPricedOffers?: Array<{
      condition: string;
      fulfillmentType: string;
      offerType: string;
      quantityTier: number;
      listingPrice: MoneyType;
      shippingPrice?: MoneyType;
      points?: { pointsNumber: number };
    }>;
    errors?: Array<{ code: string; message: string }>;
  };
  errors?: Array<{ code: string; message: string }>;
}

/** Batch response */
interface CompetitiveSummaryBatchResponse {
  responses: CompetitiveSummaryResponseItem[];
}

/**
 * Get access token from Amazon LWA
 */
async function getAccessToken(credentials: AmazonCredentials): Promise<string> {
  const response = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get access token: ${response.status} - ${errorText}`);
  }

  const tokenData = (await response.json()) as { access_token: string };
  return tokenData.access_token;
}

/**
 * Call getCompetitiveSummary API (v2022-05-01)
 * This is a batch API that can handle up to 20 ASINs
 *
 * API Reference: https://developer-docs.amazon.com/sp-api/docs/product-pricing-api-v2022-05-01-reference
 */
async function getCompetitiveSummary(
  asins: string[],
  credentials: AmazonCredentials,
  marketplaceId: string = UK_MARKETPLACE_ID
): Promise<CompetitiveSummaryBatchResponse> {
  const accessToken = await getAccessToken(credentials);

  // Build the batch request according to the schema:
  // Each request needs: asin, marketplaceId, includedData, method, uri
  // The uri for batch is the base path without the ASIN
  const requests = asins.map((asin) => ({
    asin,
    marketplaceId,
    // Request all available data including referencePrices which contains WasPrice
    includedData: ['featuredBuyingOptions', 'referencePrices', 'lowestPricedOffers'],
    method: 'GET',
    uri: '/products/pricing/2022-05-01/items/competitiveSummary',
  }));

  const url = `${EU_ENDPOINT}/batches/products/pricing/2022-05-01/items/competitiveSummary`;

  console.log(`[getCompetitiveSummary] Requesting: POST ${url}`);
  console.log(`[getCompetitiveSummary] Request body:`, JSON.stringify({ requests }, null, 2));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-amz-access-token': accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ requests }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    console.error(`[getCompetitiveSummary] Error response: ${responseText}`);
    throw new Error(`getCompetitiveSummary failed: ${response.status} - ${responseText}`);
  }

  console.log(`[getCompetitiveSummary] Response: ${responseText.substring(0, 500)}...`);

  return JSON.parse(responseText) as CompetitiveSummaryBatchResponse;
}

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

    const { searchParams } = new URL(request.url);
    const asin = searchParams.get('asin');

    if (!asin) {
      return NextResponse.json({ error: 'Missing asin parameter' }, { status: 400 });
    }

    // Get Amazon credentials from platform_credentials (encrypted)
    const credentialsRepo = new CredentialsRepository(supabase);
    const credentials = await credentialsRepo.getCredentials<AmazonCredentials>(user.id, 'amazon');

    if (!credentials) {
      return NextResponse.json(
        { error: 'Amazon credentials not found. Please connect your Amazon account.' },
        { status: 400 }
      );
    }

    // Call getCompetitiveSummary (v2022-05-01)
    const summaryResponse = await getCompetitiveSummary([asin], credentials);

    // Extract the response for our ASIN
    const asinResponse = summaryResponse.responses?.[0];

    if (!asinResponse) {
      return NextResponse.json({ error: 'No response for ASIN' }, { status: 404 });
    }

    if (asinResponse.status.statusCode !== 200) {
      return NextResponse.json(
        {
          error: `API returned status ${asinResponse.status.statusCode}: ${asinResponse.status.reasonPhrase}`,
          details: asinResponse.errors,
          bodyErrors: asinResponse.body?.errors,
          fullResponse: asinResponse,
        },
        { status: 400 }
      );
    }

    const body = asinResponse.body;

    // Extract WasPrice from referencePrices
    // Note: The API returns "name" not "referencePriceId"
    const referencePrices = body?.referencePrices ?? [];
    const wasPrice = referencePrices.find(
      (rp: { name?: string; referencePriceId?: string }) =>
        rp.name === 'WasPrice' || rp.referencePriceId === 'WAS_PRICE'
    );
    const competitivePrice = referencePrices.find(
      (rp: { name?: string; referencePriceId?: string }) =>
        rp.name === 'CompetitivePrice' || rp.referencePriceId === 'COMPETITIVE_PRICE'
    );

    // Extract featured offer (Buy Box)
    const featuredOffer = body?.featuredBuyingOptions?.[0]?.segmentedFeaturedOffers?.[0]?.featuredOffer;

    // Extract lowest priced offers
    // The structure can vary - handle both flat array and nested offers array
    const lowestPricedOffersData = body?.lowestPricedOffers ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lowestOffers = lowestPricedOffersData.flatMap((lpo: any) => {
      // Handle nested structure: { offers: [...] }
      if (lpo.offers && Array.isArray(lpo.offers)) {
        return lpo.offers;
      }
      // Handle flat structure: the item itself is an offer
      return [lpo];
    });

    return NextResponse.json({
      asin,
      marketplaceId: UK_MARKETPLACE_ID,
      status: asinResponse.status,

      // Key pricing data
      wasPrice: wasPrice?.price ?? null,
      competitivePrice: competitivePrice?.price ?? null,

      // Featured offer (Buy Box)
      featuredOffer: featuredOffer
        ? {
            listingPrice: featuredOffer.listingPrice,
            shippingPrice: featuredOffer.shippingPrice,
            totalPrice: featuredOffer.listingPrice
              ? {
                  currencyCode: featuredOffer.listingPrice.currencyCode,
                  amount:
                    featuredOffer.listingPrice.amount +
                    (featuredOffer.shippingPrice?.amount ?? 0),
                }
              : null,
            condition: featuredOffer.condition,
            offerType: featuredOffer.offerType,
          }
        : null,

      // All reference prices
      referencePrices: body?.referencePrices ?? [],

      // Lowest prices by condition/fulfillment
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lowestOffers: lowestOffers.map((offer: any) => {
        // Handle both shippingOptions (nested) and shippingPrice (flat)
        const shippingPrice = offer.shippingOptions?.[0]?.price ?? offer.shippingPrice;
        const listingPrice = offer.listingPrice;
        return {
          condition: offer.condition,
          subCondition: offer.subCondition,
          fulfillmentType: offer.fulfillmentType,
          sellerId: offer.sellerId,
          listingPrice: listingPrice,
          shippingPrice: shippingPrice,
          totalPrice: listingPrice
            ? {
                currencyCode: listingPrice.currencyCode,
                amount: listingPrice.amount + (shippingPrice?.amount ?? 0),
              }
            : null,
        };
      }),

      // Raw response for debugging
      rawResponse: summaryResponse,
    });
  } catch (error) {
    console.error('[GET /api/test/amazon-competitive-summary] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

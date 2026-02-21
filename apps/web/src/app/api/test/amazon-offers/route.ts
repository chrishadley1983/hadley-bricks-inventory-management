/**
 * Debug endpoint to call Amazon SP-API getItemOffers for a specific ASIN
 *
 * Returns all active offers on the listing (up to 20)
 * Includes each seller's price, condition, fulfilment channel
 *
 * Rate limit: 0.5 req/sec (getItemOffers)
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

/** Offer response types */
interface ShippingTime {
  minimumHours?: number;
  maximumHours?: number;
  availabilityType?: string;
  availableDate?: string;
}

interface ShipsFrom {
  country?: string;
  state?: string;
}

interface SellerFeedback {
  feedbackCount?: number;
  sellerPositiveFeedbackRating?: number;
}

interface Offer {
  myOffer: boolean;
  offerType: string;
  subCondition: string;
  sellerId: string;
  conditionNotes?: string;
  sellerFeedbackRating?: SellerFeedback;
  shippingTime?: ShippingTime;
  listingPrice: {
    currencyCode: string;
    amount: number;
  };
  shippingPrice?: {
    currencyCode: string;
    amount: number;
  };
  quantityDiscountPrices?: Array<{
    quantityTier: number;
    quantityDiscountType: string;
    listingPrice: {
      currencyCode: string;
      amount: number;
    };
  }>;
  points?: {
    pointsNumber: number;
  };
  shipsFrom?: ShipsFrom;
  isPrime?: boolean;
  isNationalPrime?: boolean;
  isFulfilledByAmazon: boolean;
  primeInformation?: {
    isPrime: boolean;
    isNationalPrime: boolean;
  };
  isBuyBoxWinner?: boolean;
  isFeaturedMerchant?: boolean;
}

interface Summary {
  totalOfferCount: number;
  numberOfOffers?: Array<{
    condition: string;
    fulfillmentChannel: string;
    offerCount: number;
  }>;
  lowestPrices?: Array<{
    condition: string;
    fulfillmentChannel: string;
    offerType?: string;
    quantityTier?: number;
    listingPrice: {
      currencyCode: string;
      amount: number;
    };
    shippingPrice?: {
      currencyCode: string;
      amount: number;
    };
    landedPrice?: {
      currencyCode: string;
      amount: number;
    };
    points?: {
      pointsNumber: number;
    };
  }>;
  buyBoxPrices?: Array<{
    condition: string;
    offerType?: string;
    quantityTier?: number;
    listingPrice: {
      currencyCode: string;
      amount: number;
    };
    shippingPrice?: {
      currencyCode: string;
      amount: number;
    };
    landedPrice?: {
      currencyCode: string;
      amount: number;
    };
    points?: {
      pointsNumber: number;
    };
  }>;
  buyBoxEligibleOffers?: Array<{
    condition: string;
    fulfillmentChannel: string;
    offerCount: number;
  }>;
  offersAvailableTime?: string;
  competitivePriceThreshold?: {
    currencyCode: string;
    amount: number;
  };
}

interface ItemOffersResponse {
  payload: {
    ASIN: string;
    status: string;
    marketplaceId: string;
    Offers?: Offer[];
    Summary?: Summary;
    Identifier?: {
      MarketplaceId: string;
      ASIN: string;
      ItemCondition: string;
    };
  };
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
 * Call getItemOffers API
 * API Reference: https://developer-docs.amazon.com/sp-api/docs/product-pricing-api-v0-reference#getitemoffer
 */
async function getItemOffers(
  asin: string,
  credentials: AmazonCredentials,
  itemCondition: 'New' | 'Used' | 'Collectible' | 'Refurbished' | 'Club' = 'New'
): Promise<ItemOffersResponse> {
  const accessToken = await getAccessToken(credentials);

  // Build URL with query params
  const url = new URL(`${EU_ENDPOINT}/products/pricing/v0/items/${asin}/offers`);
  url.searchParams.append('MarketplaceId', UK_MARKETPLACE_ID);
  url.searchParams.append('ItemCondition', itemCondition);

  console.log(`[getItemOffers] Requesting: ${url.toString()}`);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'x-amz-access-token': accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[getItemOffers] Error response: ${errorText}`);
    throw new Error(`getItemOffers failed: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<ItemOffersResponse>;
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
    const condition = (searchParams.get('condition') as 'New' | 'Used') ?? 'New';

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

    // Call getItemOffers
    const offersResponse = await getItemOffers(asin, credentials, condition);

    // Calculate some stats
    const offers = offersResponse.payload.Offers ?? [];
    const summary = offersResponse.payload.Summary;

    const stats = {
      totalOffers: offers.length,
      totalOfferCount: summary?.totalOfferCount ?? 0,
      yourOffer: offers.find((o) => o.myOffer),
      buyBoxWinner: offers.find((o) => o.isBuyBoxWinner),
      fbaOffers: offers.filter((o) => o.isFulfilledByAmazon).length,
      fbmOffers: offers.filter((o) => !o.isFulfilledByAmazon).length,
      primeOffers: offers.filter((o) => o.isPrime || o.primeInformation?.isPrime).length,
      minPrice:
        offers.length > 0
          ? Math.min(
              ...offers.map((o) => (o.listingPrice?.amount ?? 0) + (o.shippingPrice?.amount ?? 0))
            )
          : null,
      maxPrice:
        offers.length > 0
          ? Math.max(
              ...offers.map((o) => (o.listingPrice?.amount ?? 0) + (o.shippingPrice?.amount ?? 0))
            )
          : null,
      avgPrice:
        offers.length > 0
          ? offers.reduce(
              (sum, o) => sum + (o.listingPrice?.amount ?? 0) + (o.shippingPrice?.amount ?? 0),
              0
            ) / offers.length
          : null,
    };

    return NextResponse.json({
      asin,
      condition,
      marketplaceId: UK_MARKETPLACE_ID,
      status: offersResponse.payload.status,
      stats,
      summary,
      offers: offers.map((o) => ({
        sellerId: o.sellerId,
        myOffer: o.myOffer,
        isBuyBoxWinner: o.isBuyBoxWinner,
        isFulfilledByAmazon: o.isFulfilledByAmazon,
        isPrime: o.isPrime || o.primeInformation?.isPrime,
        listingPrice: o.listingPrice,
        shippingPrice: o.shippingPrice,
        totalPrice: {
          currencyCode: o.listingPrice?.currencyCode ?? 'GBP',
          amount: (o.listingPrice?.amount ?? 0) + (o.shippingPrice?.amount ?? 0),
        },
        condition: o.subCondition,
        sellerFeedback: o.sellerFeedbackRating,
        shipsFrom: o.shipsFrom,
        shippingTime: o.shippingTime,
      })),
      rawResponse: offersResponse,
    });
  } catch (error) {
    console.error('[GET /api/test/amazon-offers] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

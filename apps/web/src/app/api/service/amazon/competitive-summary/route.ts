/**
 * Service API: Amazon Competitive Summary (Pricing)
 *
 * GET - Get buy box prices for one or more ASINs
 * Uses system Amazon credentials for service calls.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withServiceAuth, getSystemUserId } from '@/lib/middleware/service-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import type { AmazonCredentials } from '@/lib/amazon/types';

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const EU_ENDPOINT = 'https://sellingpartnerapi-eu.amazon.com';
const UK_MARKETPLACE_ID = 'A1F83G8C2ARO7P';

interface MoneyType {
  currencyCode: string;
  amount: number;
}

async function getAccessToken(credentials: AmazonCredentials): Promise<string> {
  const response = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get access token: ${response.status}`);
  }

  const tokenData = (await response.json()) as { access_token: string };
  return tokenData.access_token;
}

async function getCompetitiveSummary(
  asins: string[],
  credentials: AmazonCredentials
): Promise<Record<string, {
  asin: string;
  buyBoxPrice: number | null;
  lowestNewPrice: number | null;
  wasPrice: number | null;
  currency: string;
}>> {
  const accessToken = await getAccessToken(credentials);

  const requests = asins.map((asin) => ({
    asin,
    marketplaceId: UK_MARKETPLACE_ID,
    includedData: ['featuredBuyingOptions', 'referencePrices', 'lowestPricedOffers'],
    method: 'GET',
    uri: '/products/pricing/2022-05-01/items/competitiveSummary',
  }));

  const url = `${EU_ENDPOINT}/batches/products/pricing/2022-05-01/items/competitiveSummary`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-amz-access-token': accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ requests }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`getCompetitiveSummary failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const results: Record<string, {
    asin: string;
    buyBoxPrice: number | null;
    lowestNewPrice: number | null;
    wasPrice: number | null;
    currency: string;
  }> = {};

  for (let i = 0; i < (data.responses || []).length; i++) {
    const item = data.responses[i];
    // ASIN may be in item.body.asin, item.request.asin, or match by index
    const asin = item.body?.asin || item.request?.asin || asins[i];

    if (item.status?.statusCode !== 200) {
      results[asin] = {
        asin,
        buyBoxPrice: null,
        lowestNewPrice: null,
        wasPrice: null,
        currency: 'GBP',
      };
      continue;
    }

    const body = item.body;

    // Extract WasPrice
    const referencePrices = body?.referencePrices ?? [];
    const wasPrice = referencePrices.find(
      (rp: { referencePriceId?: string }) => rp.referencePriceId === 'WAS_PRICE'
    );

    // Extract featured offer (Buy Box)
    const featuredOffer = body?.featuredBuyingOptions?.[0]?.segmentedFeaturedOffers?.[0]?.featuredOffer;
    const buyBoxPrice = featuredOffer?.listingPrice
      ? featuredOffer.listingPrice.amount + (featuredOffer.shippingPrice?.amount ?? 0)
      : null;

    // Extract lowest new price
    const lowestOffers = body?.lowestPricedOffers ?? [];
    let lowestNewPrice: number | null = null;
    for (const lpo of lowestOffers) {
      const offers = lpo.offers || [lpo];
      for (const offer of offers) {
        if (offer.condition === 'New' && offer.listingPrice) {
          const total = offer.listingPrice.amount + (offer.shippingPrice?.amount ?? 0);
          if (lowestNewPrice === null || total < lowestNewPrice) {
            lowestNewPrice = total;
          }
        }
      }
    }

    results[asin] = {
      asin,
      buyBoxPrice,
      lowestNewPrice,
      wasPrice: (wasPrice?.price as MoneyType)?.amount ?? null,
      currency: 'GBP',
    };
  }

  return results;
}

/**
 * GET /api/service/amazon/competitive-summary
 * Get buy box and competitive pricing for ASINs
 *
 * Query params:
 * - asins: Comma-separated list of ASINs (max 20)
 */
export async function GET(request: NextRequest) {
  return withServiceAuth(request, ['read'], async (_keyInfo) => {
    try {
      const { searchParams } = new URL(request.url);
      const asinsParam = searchParams.get('asins');

      if (!asinsParam) {
        return NextResponse.json(
          { error: 'Missing asins parameter. Use asins=ASIN1,ASIN2' },
          { status: 400 }
        );
      }

      const asins = asinsParam.split(',').map((a) => a.trim()).filter(Boolean);

      if (asins.length === 0) {
        return NextResponse.json(
          { error: 'No valid ASINs provided' },
          { status: 400 }
        );
      }

      if (asins.length > 20) {
        return NextResponse.json(
          { error: 'Maximum 20 ASINs per request' },
          { status: 400 }
        );
      }

      // Get Amazon credentials
      const supabase = createServiceRoleClient();
      const systemUserId = await getSystemUserId();
      const credentialsRepo = new CredentialsRepository(supabase);
      const credentials = await credentialsRepo.getCredentials<AmazonCredentials>(
        systemUserId,
        'amazon'
      );

      if (!credentials) {
        return NextResponse.json(
          { error: 'Amazon credentials not configured' },
          { status: 500 }
        );
      }

      const results = await getCompetitiveSummary(asins, credentials);

      return NextResponse.json({ data: results });
    } catch (error) {
      console.error('[GET /api/service/amazon/competitive-summary] Error:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

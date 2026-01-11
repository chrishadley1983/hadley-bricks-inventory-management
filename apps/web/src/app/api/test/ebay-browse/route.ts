/**
 * Test endpoint for eBay Browse API access
 *
 * The Browse API uses Application Access Tokens (client credentials grant)
 * rather than User Access Tokens (authorization code grant).
 */

import { NextResponse } from 'next/server';

const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_BROWSE_API_BASE = 'https://api.ebay.com/buy/browse/v1';

// Browse API requires this scope
const BROWSE_API_SCOPE = 'https://api.ebay.com/oauth/api_scope';

interface ApplicationTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface BrowseSearchResponse {
  href: string;
  total: number;
  limit: number;
  offset: number;
  itemSummaries?: Array<{
    itemId: string;
    title: string;
    price?: {
      value: string;
      currency: string;
    };
    condition?: string;
    itemWebUrl?: string;
    image?: {
      imageUrl: string;
    };
  }>;
}

/**
 * Get an Application Access Token using client credentials grant
 */
async function getApplicationToken(): Promise<string> {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET environment variables');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: BROWSE_API_SCOPE,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get application token: ${response.status} - ${errorText}`);
  }

  const data: ApplicationTokenResponse = await response.json();
  return data.access_token;
}

/**
 * Search for items using the Browse API
 */
async function searchItems(
  accessToken: string,
  query: string,
  limit: number = 5
): Promise<BrowseSearchResponse> {
  const url = new URL(`${EBAY_BROWSE_API_BASE}/item_summary/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
      'X-EBAY-C-ENDUSERCTX': 'affiliateCampaignId=<ePNCampaignId>,affiliateReferenceId=<referenceId>',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Browse API search failed: ${response.status} - ${errorText}`);
  }

  return response.json();
}

/**
 * Get a specific item by ID
 */
async function getItem(accessToken: string, itemId: string): Promise<unknown> {
  const url = `${EBAY_BROWSE_API_BASE}/item/${itemId}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Browse API get item failed: ${response.status} - ${errorText}`);
  }

  return response.json();
}

export async function GET() {
  try {
    console.log('[eBay Browse Test] Starting test...');

    // Step 1: Get application token
    console.log('[eBay Browse Test] Getting application token...');
    const accessToken = await getApplicationToken();
    console.log('[eBay Browse Test] Got application token successfully');

    // Step 2: Test search - search for LEGO sets
    console.log('[eBay Browse Test] Testing search API...');
    const searchResults = await searchItems(accessToken, 'LEGO 75192', 3);
    console.log(`[eBay Browse Test] Search returned ${searchResults.total} total results`);

    // Step 3: If we have results, try to get item details
    let itemDetails = null;
    if (searchResults.itemSummaries && searchResults.itemSummaries.length > 0) {
      const firstItemId = searchResults.itemSummaries[0].itemId;
      console.log(`[eBay Browse Test] Getting details for item ${firstItemId}...`);
      try {
        itemDetails = await getItem(accessToken, firstItemId);
        console.log('[eBay Browse Test] Got item details successfully');
      } catch (error) {
        console.warn('[eBay Browse Test] Failed to get item details:', error);
        // This is optional, don't fail the whole test
      }
    }

    return NextResponse.json({
      success: true,
      message: 'eBay Browse API access is working',
      results: {
        tokenObtained: true,
        searchWorking: true,
        totalResults: searchResults.total,
        sampleItems: searchResults.itemSummaries?.map((item) => ({
          itemId: item.itemId,
          title: item.title,
          price: item.price,
          condition: item.condition,
          url: item.itemWebUrl,
        })),
        itemDetailsWorking: itemDetails !== null,
      },
    });
  } catch (error) {
    console.error('[eBay Browse Test] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        hint:
          error instanceof Error && error.message.includes('Missing EBAY')
            ? 'Ensure EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are set in .env.local'
            : 'Check the server logs for more details',
      },
      { status: 500 }
    );
  }
}

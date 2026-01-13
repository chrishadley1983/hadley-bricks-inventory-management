/**
 * Test script to call Amazon SP-API getItemOffers directly
 *
 * Usage: npx tsx scripts/test-amazon-offers.ts B09RGQ6BWL
 */

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const EU_ENDPOINT = 'https://sellingpartnerapi-eu.amazon.com';
const UK_MARKETPLACE_ID = 'A1F83G8C2ARO7P';

// Hardcoded for this test script - normally would use env vars
const SUPABASE_URL = 'https://modjoikyuhqzouxvieua.supabase.co';
const SUPABASE_SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vZGpvaWt5dWhxem91eHZpZXVhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjE0MTcyOSwiZXhwIjoyMDgxNzE3NzI5fQ.5qFwF4eEnJxn_mg-KHe9hBRr6TIrLZyJtSWfXj0PSmk';

interface AmazonCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

async function getCredentialsFromSupabase(): Promise<AmazonCredentials> {
  console.log('\nFetching Amazon credentials from Supabase...');

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_credentials?platform=eq.amazon&limit=1&select=user_id,credentials`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch credentials: ${response.status}`);
  }

  const data = (await response.json()) as Array<{ user_id: string; credentials: AmazonCredentials }>;

  if (!data || data.length === 0) {
    throw new Error('No Amazon credentials found in database');
  }

  console.log('Found credentials for user:', data[0].user_id);
  return data[0].credentials;
}

async function getAccessToken(credentials: AmazonCredentials): Promise<string> {
  console.log('Getting access token...');

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
  console.log('Access token obtained successfully');
  return tokenData.access_token;
}

async function getItemOffers(
  asin: string,
  accessToken: string,
  itemCondition: string = 'New'
): Promise<unknown> {
  const url = new URL(`${EU_ENDPOINT}/products/pricing/v0/items/${asin}/offers`);
  url.searchParams.append('MarketplaceId', UK_MARKETPLACE_ID);
  url.searchParams.append('ItemCondition', itemCondition);

  console.log(`Calling: GET ${url.toString()}`);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'x-amz-access-token': accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  const responseText = await response.text();

  if (!response.ok) {
    console.error('Error response:', responseText);
    throw new Error(`getItemOffers failed: ${response.status}`);
  }

  return JSON.parse(responseText);
}

async function main() {
  const asin = process.argv[2] || 'B09RGQ6BWL';

  console.log('='.repeat(60));
  console.log(`Testing Amazon SP-API getItemOffers for ASIN: ${asin}`);
  console.log('='.repeat(60));

  try {
    // Get credentials from Supabase
    const credentials = await getCredentialsFromSupabase();

    // Get access token
    const accessToken = await getAccessToken(credentials);

    // Get item offers
    console.log('\nFetching item offers...');
    const offersResponse = await getItemOffers(asin, accessToken, 'New');

    console.log('\n' + '='.repeat(60));
    console.log('RESPONSE:');
    console.log('='.repeat(60));
    console.log(JSON.stringify(offersResponse, null, 2));

    // Parse and summarize
    const payload = (offersResponse as { payload?: { Offers?: unknown[]; Summary?: { totalOfferCount?: number } } })
      .payload;
    const offers = payload?.Offers ?? [];
    const summary = payload?.Summary;

    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY:');
    console.log('='.repeat(60));
    console.log(`Total offers returned: ${offers.length}`);
    console.log(`Total offer count (from API): ${summary?.totalOfferCount ?? 'N/A'}`);

    if (offers.length > 0) {
      console.log('\nOffer breakdown:');
      offers.forEach((offer: unknown, i: number) => {
        const o = offer as {
          myOffer?: boolean;
          isBuyBoxWinner?: boolean;
          isFulfilledByAmazon?: boolean;
          sellerId?: string;
          listingPrice?: { amount?: number; currencyCode?: string };
          shippingPrice?: { amount?: number };
          subCondition?: string;
          sellerFeedbackRating?: { feedbackCount?: number; sellerPositiveFeedbackRating?: number };
        };
        const totalPrice = (o.listingPrice?.amount ?? 0) + (o.shippingPrice?.amount ?? 0);
        console.log(
          `  ${i + 1}. ${o.myOffer ? '[YOUR OFFER]' : ''} ${o.isBuyBoxWinner ? '[BUY BOX]' : ''} ` +
            `${o.isFulfilledByAmazon ? 'FBA' : 'FBM'} - ` +
            `${o.listingPrice?.currencyCode ?? 'GBP'} ${totalPrice.toFixed(2)} ` +
            `(Seller: ${o.sellerId?.slice(0, 8)}..., Condition: ${o.subCondition ?? 'N/A'}, ` +
            `Feedback: ${o.sellerFeedbackRating?.sellerPositiveFeedbackRating ?? 'N/A'}%)`
        );
      });
    }
  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  }
}

main();

/**
 * Amazon Listing Verification API
 *
 * GET /api/amazon/sync/verify?sku=XXX
 *
 * Queries Amazon Listings API to verify current listing status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import { AmazonListingsClient } from '@/lib/amazon/amazon-listings.client';
import type { AmazonCredentials } from '@/lib/amazon/types';

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

    // Get SKU from query params
    const { searchParams } = new URL(request.url);
    const sku = searchParams.get('sku');

    if (!sku) {
      return NextResponse.json({ error: 'SKU parameter is required' }, { status: 400 });
    }

    // Get Amazon credentials
    const credentialsRepo = new CredentialsRepository(supabase);
    const amazonCredentials = await credentialsRepo.getCredentials<AmazonCredentials>(
      user.id,
      'amazon'
    );

    if (!amazonCredentials) {
      return NextResponse.json({ error: 'Amazon credentials not found' }, { status: 400 });
    }

    // Query Amazon Listings API
    const listingsClient = new AmazonListingsClient(amazonCredentials);
    const listing = await listingsClient.getListing(
      sku,
      'A1F83G8C2ARO7P', // UK marketplace
      ['summaries', 'offers', 'fulfillmentAvailability', 'attributes']
    );

    if (!listing) {
      return NextResponse.json({
        found: false,
        sku,
        message: 'Listing not found in Amazon',
      });
    }

    // Extract price and quantity
    const offer = listing.offers?.find((o) => o.marketplaceId === 'A1F83G8C2ARO7P');
    const fulfillment = listing.fulfillmentAvailability?.find(
      (f) => f.fulfillmentChannelCode === 'DEFAULT'
    );
    const summary = listing.summaries?.find((s) => s.marketplaceId === 'A1F83G8C2ARO7P');

    return NextResponse.json({
      found: true,
      sku,
      asin: summary?.asin,
      productType: summary?.productType,
      status: summary?.status,
      price: offer?.price,
      quantity: fulfillment?.quantity,
      raw: listing,
    });
  } catch (error) {
    console.error('[GET /api/amazon/sync/verify] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to verify listing',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

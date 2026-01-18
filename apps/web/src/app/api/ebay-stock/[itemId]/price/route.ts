/**
 * PUT /api/ebay-stock/[itemId]/price
 *
 * Update the price of an eBay listing including Best Offer thresholds.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { EbayTradingClient } from '@/lib/platform-stock/ebay/ebay-trading.client';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';

const UpdatePriceSchema = z.object({
  newPrice: z.number().positive('Price must be positive'),
  updateBestOffer: z.boolean().default(true),
  autoAcceptPercent: z.number().min(0).max(100).default(90),
  minOfferPercent: z.number().min(0).max(100).default(70),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const { itemId } = await params;

    // 1. Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Validate input
    const body = await request.json();
    const parsed = UpdatePriceSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { newPrice, updateBestOffer, autoAcceptPercent, minOfferPercent } = parsed.data;

    // 3. Get eBay access token
    const ebayAuth = new EbayAuthService();
    const accessToken = await ebayAuth.getAccessToken(user.id);

    if (!accessToken) {
      return NextResponse.json(
        { error: 'eBay not connected. Please connect your eBay account first.' },
        { status: 400 }
      );
    }

    // 4. Create trading client and update the listing
    const tradingClient = new EbayTradingClient({
      accessToken,
      siteId: 3, // UK
    });

    // Calculate Best Offer prices
    const autoAcceptPrice = updateBestOffer
      ? Math.round((newPrice * autoAcceptPercent) / 100 * 100) / 100
      : undefined;
    const minOfferPrice = updateBestOffer
      ? Math.round((newPrice * minOfferPercent) / 100 * 100) / 100
      : undefined;

    // 5. Call eBay API to revise the listing
    const result = await tradingClient.reviseFixedPriceItem({
      itemId,
      startPrice: newPrice,
      bestOfferEnabled: updateBestOffer ? true : undefined,
      bestOfferAutoAcceptPrice: autoAcceptPrice,
      minimumBestOfferPrice: minOfferPrice,
      currency: 'GBP',
    });

    if (!result.success) {
      return NextResponse.json(
        {
          error: 'Failed to update eBay listing',
          details: result.errorMessage,
          errorCode: result.errorCode,
        },
        { status: 400 }
      );
    }

    // 6. Update the local database record
    const { data: updatedRows, error: updateError } = await supabase
      .from('platform_listings')
      .update({
        price: newPrice,
        updated_at: new Date().toISOString(),
      })
      .eq('platform_item_id', itemId)
      .eq('user_id', user.id)
      .eq('platform', 'ebay')
      .select('id');

    if (updateError) {
      console.error('[PUT /api/ebay-stock/[itemId]/price] DB update error:', updateError);
      // Don't fail the request - eBay update succeeded
    } else if (!updatedRows || updatedRows.length === 0) {
      console.warn('[PUT /api/ebay-stock/[itemId]/price] No local listing found to update for itemId:', itemId);
      // Don't fail - eBay update succeeded, local record may not exist yet
    }

    // 7. Return success response
    return NextResponse.json({
      data: {
        success: true,
        itemId,
        newPrice,
        autoAcceptPrice: autoAcceptPrice ?? null,
        minOfferPrice: minOfferPrice ?? null,
        warnings: result.warnings,
      },
    });
  } catch (error) {
    console.error('[PUT /api/ebay-stock/[itemId]/price] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Debug endpoint to understand eBay listing filter behavior
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getEbayBrowseClient } from '@/lib/ebay/ebay-browse.client';
import { isValidLegoListing, getListingRejectionReason } from '@/lib/arbitrage/ebay-listing-validator';

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
    const setNumber = searchParams.get('set') || '75192-1';

    const client = getEbayBrowseClient();
    const searchResult = await client.searchLegoSet(setNumber, 50);

    const rawListings = searchResult.itemSummaries ?? [];
    const cleanSetNumber = setNumber.replace(/-\d+$/, '');

    // Categorize why listings are being filtered
    const results = rawListings.map(item => {
      const valid = isValidLegoListing(item.title, setNumber);
      const reason = getListingRejectionReason(item.title, setNumber);
      return {
        title: item.title,
        price: item.price?.value,
        valid,
        rejectionReason: reason,
        hasSetNumber: item.title.includes(cleanSetNumber),
        hasLego: item.title.toLowerCase().includes('lego'),
      };
    });

    // Summary
    const summary = {
      setNumber,
      cleanSetNumber,
      totalFromApi: rawListings.length,
      passedFilter: results.filter(r => r.valid).length,
      failedFilter: results.filter(r => !r.valid).length,
      failureReasons: {
        missingSetNumber: results.filter(r => !r.hasSetNumber).length,
        missingLego: results.filter(r => r.hasSetNumber && !r.hasLego).length,
        excludePattern: results.filter(r => r.hasSetNumber && r.hasLego && !r.valid).length,
      },
    };

    // Sample rejected listings grouped by reason
    const rejectedByReason: Record<string, string[]> = {};
    results
      .filter(r => !r.valid)
      .forEach(r => {
        const reason = r.rejectionReason || 'unknown';
        if (!rejectedByReason[reason]) rejectedByReason[reason] = [];
        if (rejectedByReason[reason].length < 3) {
          rejectedByReason[reason].push(r.title);
        }
      });

    return NextResponse.json({
      summary,
      rejectedByReason,
      validListings: results.filter(r => r.valid).slice(0, 5),
    });
  } catch (error) {
    console.error('[GET /api/test/ebay-filter-debug] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

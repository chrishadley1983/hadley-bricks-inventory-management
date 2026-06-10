/**
 * eBay Business Policies API Route
 *
 * GET /api/ebay/business-policies - Get cached business policies
 * POST /api/ebay/business-policies - Force refresh from eBay API
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { EbayBusinessPoliciesService } from '@/lib/ebay/ebay-business-policies.service';

/**
 * GET /api/ebay/business-policies
 *
 * Returns cached eBay business policies (fulfillment, payment, return).
 * If cache is stale (>24 hours) or empty, fetches fresh data from eBay.
 */
export async function GET() {
  try {
    // 1. Auth check
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // 2. Get policies (from cache or eBay)
    const service = new EbayBusinessPoliciesService(supabase, user.id);
    const policies = await service.getPolicies();

    // 3. Return response
    return NextResponse.json({ data: policies }, { status: 200 });
  } catch (error) {
    console.error('[GET /api/ebay/business-policies] Error:', error);

    if (error instanceof Error && error.message.includes('access token')) {
      return NextResponse.json(
        { error: 'eBay authentication required. Please reconnect your eBay account.' },
        { status: 401 }
      );
    }

    return NextResponse.json({ error: 'Failed to fetch business policies' }, { status: 500 });
  }
}

/**
 * POST /api/ebay/business-policies
 *
 * Force refresh policies from eBay API, bypassing cache.
 */
export async function POST() {
  try {
    // 1. Auth check
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // 2. Force refresh policies
    const service = new EbayBusinessPoliciesService(supabase, user.id);
    const policies = await service.refreshPolicies();

    // 3. Return response
    return NextResponse.json({ data: policies }, { status: 200 });
  } catch (error) {
    console.error('[POST /api/ebay/business-policies] Error:', error);

    if (error instanceof Error && error.message.includes('access token')) {
      return NextResponse.json(
        { error: 'eBay authentication required. Please reconnect your eBay account.' },
        { status: 401 }
      );
    }

    return NextResponse.json({ error: 'Failed to refresh business policies' }, { status: 500 });
  }
}

/**
 * DELETE /api/ebay/business-policies
 *
 * Clear cached policies for the user.
 */
export async function DELETE() {
  try {
    // 1. Auth check
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // 2. Clear cache
    const service = new EbayBusinessPoliciesService(supabase, user.id);
    await service.clearCache();

    // 3. Return response
    return NextResponse.json({ message: 'Cache cleared' }, { status: 200 });
  } catch (error) {
    console.error('[DELETE /api/ebay/business-policies] Error:', error);
    return NextResponse.json({ error: 'Failed to clear cache' }, { status: 500 });
  }
}

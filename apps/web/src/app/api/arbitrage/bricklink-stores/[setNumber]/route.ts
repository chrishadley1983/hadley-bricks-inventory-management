/**
 * BrickLink Store Listings API Route (Single Set)
 *
 * GET /api/arbitrage/bricklink-stores/[setNumber] - Get cached store listings
 * POST /api/arbitrage/bricklink-stores/[setNumber] - Trigger scrape and return listings
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BrickLinkStoreDealService } from '@/lib/arbitrage/bricklink-store-deal.service';
import { BrickLinkSessionExpiredError } from '@/lib/arbitrage/bricklink-store-scraper';

// BrickLink set numbers: digits with optional dash suffix (e.g. "10312" or "10312-1")
const SET_NUMBER_REGEX = /^\d{3,7}(-\d+)?$/;

export const maxDuration = 60;

// ============================================================================
// GET - Return cached listings from DB (no scrape)
// ============================================================================

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ setNumber: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { setNumber } = await params;

    if (!SET_NUMBER_REGEX.test(setNumber)) {
      return NextResponse.json({ error: 'Invalid set number format' }, { status: 400 });
    }

    const service = new BrickLinkStoreDealService(supabase);
    const listings = await service.getListingsForSet(user.id, setNumber);

    return NextResponse.json({ data: listings });
  } catch (error) {
    console.error('[GET /api/arbitrage/bricklink-stores/[setNumber]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================================
// POST - Trigger scrape for this set, store results, return filtered listings
// ============================================================================

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ setNumber: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { setNumber } = await params;

    if (!SET_NUMBER_REGEX.test(setNumber)) {
      return NextResponse.json({ error: 'Invalid set number format' }, { status: 400 });
    }

    const service = new BrickLinkStoreDealService(supabase);

    // Scrape and store
    const scrapeResult = await service.scrapeAndStore(user.id, setNumber);

    // Return fresh listings
    const listings = await service.getListingsForSet(user.id, setNumber);

    return NextResponse.json({
      scrapeResult,
      data: listings,
    });
  } catch (error) {
    if (error instanceof BrickLinkSessionExpiredError) {
      return NextResponse.json(
        { error: 'BrickLink session expired. Run `npm run bricklink:login` to refresh.' },
        { status: 401 }
      );
    }
    console.error('[POST /api/arbitrage/bricklink-stores/[setNumber]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

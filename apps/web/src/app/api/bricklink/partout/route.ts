/**
 * BrickLink Partout Value API Route
 *
 * GET /api/bricklink/partout?setNumber=XXX
 *
 * Fetches the partout value (total value of individual parts) for a LEGO set.
 * Uses caching to minimize BrickLink API calls.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BrickLinkClient } from '@/lib/bricklink';
import type { BrickLinkCredentials } from '@/lib/bricklink';
import { CredentialsRepository } from '@/lib/repositories';
import { PartoutService } from '@/lib/bricklink/partout.service';
import { PartPriceCacheService } from '@/lib/bricklink/part-price-cache.service';
import type { PartoutApiResponse, PartoutApiError } from '@/types/partout';

const QuerySchema = z.object({
  setNumber: z.string().min(1, 'Set number is required'),
  forceRefresh: z.coerce.boolean().optional().default(false),
});

export async function GET(request: NextRequest): Promise<NextResponse<PartoutApiResponse | PartoutApiError>> {
  try {
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
    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      setNumber: searchParams.get('setNumber'),
      forceRefresh: searchParams.get('forceRefresh'),
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid set number',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { setNumber, forceRefresh } = parsed.data;
    console.log(`[GET /api/bricklink/partout] Fetching partout for set ${setNumber}${forceRefresh ? ' (force refresh)' : ''}`);

    // 3. Get BrickLink credentials
    const credentialsRepo = new CredentialsRepository(supabase);
    const credentials = await credentialsRepo.getCredentials<BrickLinkCredentials>(
      user.id,
      'bricklink'
    );

    if (!credentials) {
      return NextResponse.json(
        { error: 'BrickLink not configured. Please configure BrickLink credentials in Settings.' },
        { status: 400 }
      );
    }

    // 4. Create services
    const brickLinkClient = new BrickLinkClient(credentials);
    const cacheService = new PartPriceCacheService(supabase);
    const partoutService = new PartoutService(brickLinkClient, cacheService);

    // 5. Get partout value
    const data = await partoutService.getPartoutValue(setNumber, { forceRefresh });

    console.log(`[GET /api/bricklink/partout] Success: ${data.totalParts} parts, POV £${data.povNew.toFixed(2)} (new)`);

    return NextResponse.json({ data });
  } catch (error) {
    console.error('[GET /api/bricklink/partout] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Internal server error';

    // Check for specific BrickLink API errors
    if (errorMessage.includes('404') || errorMessage.includes('not found')) {
      return NextResponse.json(
        { error: 'Set not found on BrickLink. Please check the set number.' },
        { status: 404 }
      );
    }

    if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
      return NextResponse.json(
        { error: 'BrickLink API rate limit exceeded. Please try again later.' },
        { status: 429 }
      );
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

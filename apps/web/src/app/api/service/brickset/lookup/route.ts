/**
 * Service API: Brickset Lookup
 *
 * GET - Look up a LEGO set by set number
 * Uses system Brickset API key for service calls.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withServiceAuth } from '@/lib/middleware/service-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { BricksetCacheService } from '@/lib/brickset';

const QuerySchema = z.object({
  setNumber: z.string().min(1, 'Set number is required'),
  forceRefresh: z.coerce.boolean().optional().default(false),
});

/**
 * GET /api/service/brickset/lookup
 * Look up a set by set number using system credentials
 *
 * Query params:
 * - setNumber: The set number to look up (e.g., "75192-1" or "75192")
 * - forceRefresh: Force refresh from API even if cached (default: false)
 */
export async function GET(request: NextRequest) {
  return withServiceAuth(request, ['read'], async (_keyInfo) => {
    try {
      // Parse query parameters
      const url = new URL(request.url);
      const params = {
        setNumber: url.searchParams.get('setNumber'),
        forceRefresh: url.searchParams.get('forceRefresh'),
      };

      const parsed = QuerySchema.safeParse(params);

      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: parsed.error.flatten() },
          { status: 400 }
        );
      }

      const { setNumber, forceRefresh } = parsed.data;

      // Use service role client for cache operations
      const supabase = createServiceRoleClient();
      const cacheService = new BricksetCacheService(supabase);

      // API key is optional - cache can serve data without it
      const apiKey = process.env.BRICKSET_API_KEY;
      if (!apiKey && forceRefresh) {
        return NextResponse.json(
          { error: 'Brickset API key not configured on server (cannot force refresh)' },
          { status: 500 }
        );
      }

      const set = await cacheService.getSet(setNumber, apiKey || '', forceRefresh);

      if (!set) {
        return NextResponse.json(
          { error: 'Set not found', message: 'Set not found in cache or Brickset API' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        data: set,
        source: set.lastFetchedAt && new Date(set.lastFetchedAt) > new Date(Date.now() - 60000)
          ? 'api'
          : 'cache',
      });
    } catch (error) {
      console.error('[GET /api/service/brickset/lookup] Error:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

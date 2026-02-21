import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { BricksetCredentialsService } from '@/lib/services';
import { BricksetCacheService } from '@/lib/brickset';

const QuerySchema = z.object({
  setNumber: z.string().min(1, 'Set number is required'),
  forceRefresh: z.coerce.boolean().optional().default(false),
});

/**
 * GET /api/brickset/lookup
 * Look up a set by set number
 *
 * Query params:
 * - setNumber: The set number to look up (e.g., "75192-1" or "75192")
 * - forceRefresh: Force refresh from API even if cached (default: false)
 */
export async function GET(request: NextRequest) {
  try {
    // Validate auth via API key or session cookie
    const auth = await validateAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service role client for API key auth (bypasses RLS)
    const isApiKeyAuth = !!request.headers.get('x-api-key');
    const supabase = isApiKeyAuth ? createServiceRoleClient() : await createClient();
    const userId = auth.userId;

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

    // Get API key if available
    const credentialsService = new BricksetCredentialsService(supabase);
    const apiKey = await credentialsService.getApiKey(userId);

    // Use cache service to get set
    const cacheService = new BricksetCacheService(supabase);
    const set = await cacheService.getSet(setNumber, apiKey || undefined, forceRefresh);

    if (!set) {
      return NextResponse.json(
        {
          error: 'Set not found',
          message: apiKey
            ? 'Set not found in cache or Brickset API'
            : 'Set not found in cache. Configure Brickset API to search for uncached sets.',
        },
        { status: 404 }
      );
    }

    // Update last used timestamp if we used the API
    if (apiKey) {
      await credentialsService.updateLastUsed(userId);
    }

    return NextResponse.json({
      data: set,
      source:
        set.lastFetchedAt && new Date(set.lastFetchedAt) > new Date(Date.now() - 60000)
          ? 'api'
          : 'cache',
    });
  } catch (error) {
    console.error('[GET /api/brickset/lookup] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

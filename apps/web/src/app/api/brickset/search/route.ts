import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BricksetCredentialsService } from '@/lib/services';
import { BricksetCacheService } from '@/lib/brickset';

const QuerySchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  theme: z.string().optional(),
  year: z.coerce.number().optional(),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  useApi: z.coerce.boolean().optional().default(false),
});

/**
 * GET /api/brickset/search
 * Search for sets
 *
 * Query params:
 * - query: Search query (searches name, set number, theme)
 * - theme: Filter by theme (optional)
 * - year: Filter by year (optional)
 * - limit: Max results to return (default: 50, max: 100)
 * - useApi: Fall back to API if no local results (default: false)
 */
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

    // Parse query parameters
    const url = new URL(request.url);
    const params = {
      query: url.searchParams.get('query'),
      theme: url.searchParams.get('theme'),
      year: url.searchParams.get('year'),
      limit: url.searchParams.get('limit'),
      useApi: url.searchParams.get('useApi'),
    };

    const parsed = QuerySchema.safeParse(params);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { query, theme, year, limit, useApi } = parsed.data;

    // Get API key if we want to use API fallback
    let apiKey: string | null = null;
    if (useApi) {
      const credentialsService = new BricksetCredentialsService(supabase);
      apiKey = await credentialsService.getApiKey(user.id);
    }

    // Use cache service to search
    const cacheService = new BricksetCacheService(supabase);
    const sets = await cacheService.searchSets(query, apiKey || undefined, {
      theme,
      year,
      limit,
      useApiIfNoResults: useApi,
    });

    return NextResponse.json({
      data: sets,
      count: sets.length,
      query,
      filters: { theme, year },
    });
  } catch (error) {
    console.error('[GET /api/brickset/search] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

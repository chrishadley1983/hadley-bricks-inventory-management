import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BricksetCredentialsService } from '@/lib/services';
import { BricksetCacheService } from '@/lib/brickset';

/**
 * GET /api/brickset/usage
 * Get Brickset API usage statistics and cache stats
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const credentialsService = new BricksetCredentialsService(supabase);
    const cacheService = new BricksetCacheService(supabase);

    // Get credentials status and API usage
    const usageStats = await credentialsService.getUsageStats(user.id);

    // Get cache statistics
    const cacheStats = await cacheService.getCacheStats();

    return NextResponse.json({
      configured: usageStats.configured,
      lastUsedAt: usageStats.lastUsedAt,
      apiUsage: usageStats.apiUsage,
      cache: cacheStats,
    });
  } catch (error) {
    console.error('[GET /api/brickset/usage] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

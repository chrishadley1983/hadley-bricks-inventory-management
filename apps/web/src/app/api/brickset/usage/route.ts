import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { BricksetCredentialsService } from '@/lib/services';
import { BricksetCacheService } from '@/lib/brickset';

/**
 * GET /api/brickset/usage
 * Get Brickset API usage statistics and cache stats
 */
export async function GET() {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

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

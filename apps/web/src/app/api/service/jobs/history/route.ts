/**
 * Service API: Job Execution History
 *
 * GET /api/service/jobs/history
 *
 * Query job execution history with filtering and pagination.
 * Authenticated via x-api-key header (read permission).
 *
 * Query params:
 * - job_name: Filter by job name (e.g. 'full-sync', 'amazon-pricing')
 * - status: Filter by status ('running', 'completed', 'failed', 'timeout')
 * - since: ISO date - only show executions after this time
 * - until: ISO date - only show executions before this time
 * - limit: Number of results (default 50, max 200)
 * - offset: Pagination offset (default 0)
 *
 * Defaults to last 24 hours if no time range specified.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withServiceAuth } from '@/lib/middleware/service-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  return withServiceAuth(request, ['read'], async () => {
    try {
      const url = new URL(request.url);
      const jobName = url.searchParams.get('job_name');
      const status = url.searchParams.get('status');
      const since = url.searchParams.get('since');
      const until = url.searchParams.get('until');
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 200);
      const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

      const supabase = createServiceRoleClient();

      // Build query
      let query = supabase
        .from('job_execution_history')
        .select('*', { count: 'exact' });

      // Apply filters
      if (jobName) {
        query = query.eq('job_name', jobName);
      }

      if (status) {
        query = query.eq('status', status);
      }

      // Time range: default to last 24 hours if neither since nor until specified
      if (since) {
        query = query.gte('started_at', since);
      } else if (!until) {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        query = query.gte('started_at', twentyFourHoursAgo);
      }

      if (until) {
        query = query.lte('started_at', until);
      }

      // Order and paginate
      query = query
        .order('started_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) {
        console.error('[GET /api/service/jobs/history] Query error:', error);
        return NextResponse.json(
          { error: 'Failed to query job history' },
          { status: 500 }
        );
      }

      const total = count ?? 0;

      return NextResponse.json({
        data: data ?? [],
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      });
    } catch (error) {
      console.error('[GET /api/service/jobs/history] Error:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

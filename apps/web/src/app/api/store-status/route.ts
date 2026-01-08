import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ReportingService } from '@/lib/services';

const GetQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
});

const PostBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  platform: z.enum(['amazon', 'ebay', 'bricklink']),
  status: z.enum(['O', 'C', 'H']),
});

const BatchPutBodySchema = z.object({
  statuses: z.array(PostBodySchema),
});

/**
 * GET /api/store-status
 * Get store statuses for a date range
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

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = GetQuerySchema.safeParse(searchParams);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { startDate, endDate } = parsed.data;

    const reportingService = new ReportingService(supabase);
    const statuses = await reportingService.getStoreStatuses(user.id, {
      startDate: new Date(startDate),
      endDate: new Date(endDate),
    });

    return NextResponse.json({ data: statuses });
  } catch (error) {
    console.error('[GET /api/store-status] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/store-status
 * Set store status for a single date/platform
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = PostBodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { date, platform, status } = parsed.data;

    const reportingService = new ReportingService(supabase);
    const result = await reportingService.setStoreStatus(user.id, date, platform, status);

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/store-status] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/store-status
 * Batch update store statuses
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = BatchPutBodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { statuses } = parsed.data;

    const reportingService = new ReportingService(supabase);
    const results = await reportingService.batchSetStoreStatuses(user.id, statuses);

    return NextResponse.json({ data: results });
  } catch (error) {
    console.error('[PUT /api/store-status] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

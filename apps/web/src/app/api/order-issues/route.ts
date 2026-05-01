import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { OrderIssueService, OrderNotFoundError } from '@/lib/services';
import { createOrderIssueSchema, ORDER_ISSUE_PLATFORMS } from '@/lib/schemas/order-issue.schema';

const QuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(50),
  openOnly: z
    .enum(['true', 'false'])
    .optional()
    .default('true')
    .transform((v) => v === 'true'),
  platform: z.enum(ORDER_ISSUE_PLATFORMS).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await validateAuth(request);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isApiKeyAuth = !!request.headers.get('x-api-key');
    const supabase = isApiKeyAuth ? createServiceRoleClient() : await createClient();

    const parsed = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { page, pageSize, openOnly, platform } = parsed.data;
    const service = new OrderIssueService(supabase);
    const result = await service.list(
      auth.userId,
      { openOnly, platform },
      { page, pageSize },
    );

    return NextResponse.json({
      data: result.data,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    console.error('[GET /api/order-issues] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await validateAuth(request);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isApiKeyAuth = !!request.headers.get('x-api-key');
    const supabase = isApiKeyAuth ? createServiceRoleClient() : await createClient();

    const body = await request.json();
    const parsed = createOrderIssueSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const service = new OrderIssueService(supabase);
    try {
      const result = await service.create(auth.userId, parsed.data);
      return NextResponse.json({ data: result }, { status: 201 });
    } catch (e) {
      if (e instanceof OrderNotFoundError) {
        return NextResponse.json({ error: e.message, code: 'order_not_found' }, { status: 400 });
      }
      throw e;
    }
  } catch (error) {
    console.error('[POST /api/order-issues] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

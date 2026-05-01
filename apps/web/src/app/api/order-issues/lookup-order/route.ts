import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { OrderIssueService, OrderNotFoundError } from '@/lib/services';
import { ORDER_ISSUE_PLATFORMS } from '@/lib/schemas/order-issue.schema';

const QuerySchema = z.object({
  platform: z.enum(ORDER_ISSUE_PLATFORMS),
  platform_order_id: z.string().min(1),
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
        { error: 'Invalid query', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const service = new OrderIssueService(supabase);
    try {
      const data = await service.lookupOrder(
        auth.userId,
        parsed.data.platform,
        parsed.data.platform_order_id,
      );
      return NextResponse.json({ data });
    } catch (e) {
      if (e instanceof OrderNotFoundError) {
        return NextResponse.json({ error: e.message, code: 'order_not_found' }, { status: 404 });
      }
      throw e;
    }
  } catch (error) {
    console.error('[GET /api/order-issues/lookup-order] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

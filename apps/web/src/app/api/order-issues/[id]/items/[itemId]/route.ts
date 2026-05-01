import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { OrderIssueService } from '@/lib/services';
import { updateOrderIssueItemSchema } from '@/lib/schemas/order-issue.schema';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id, itemId } = await params;
    const auth = await validateAuth(request);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isApiKeyAuth = !!request.headers.get('x-api-key');
    const supabase = isApiKeyAuth ? createServiceRoleClient() : await createClient();

    const body = await request.json();
    const parsed = updateOrderIssueItemSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const service = new OrderIssueService(supabase);
    const updated = await service.updateItem(auth.userId, id, itemId, parsed.data);
    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error('[PATCH /api/order-issues/[id]/items/[itemId]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id, itemId } = await params;
    const auth = await validateAuth(request);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isApiKeyAuth = !!request.headers.get('x-api-key');
    const supabase = isApiKeyAuth ? createServiceRoleClient() : await createClient();
    const service = new OrderIssueService(supabase);
    await service.removeItem(auth.userId, id, itemId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[DELETE /api/order-issues/[id]/items/[itemId]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

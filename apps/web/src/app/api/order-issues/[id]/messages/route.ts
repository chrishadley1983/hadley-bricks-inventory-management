import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { OrderIssueService } from '@/lib/services';
import { createOrderIssueMessageSchema } from '@/lib/schemas/order-issue.schema';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await validateAuth(request);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isApiKeyAuth = !!request.headers.get('x-api-key');
    const supabase = isApiKeyAuth ? createServiceRoleClient() : await createClient();
    const service = new OrderIssueService(supabase);

    const messages = await service.listMessages(auth.userId, id);
    return NextResponse.json({ data: messages });
  } catch (error) {
    console.error('[GET /api/order-issues/[id]/messages] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await validateAuth(request);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isApiKeyAuth = !!request.headers.get('x-api-key');
    const supabase = isApiKeyAuth ? createServiceRoleClient() : await createClient();

    const body = await request.json();
    const parsed = createOrderIssueMessageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const service = new OrderIssueService(supabase);
    const message = await service.addMessage(auth.userId, id, parsed.data);
    return NextResponse.json({ data: message }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/order-issues/[id]/messages] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/api/require-user';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const { id } = await params;
    const supabase = createServiceRoleClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase deep type inference workaround
    const { data: proposal, error: fetchError } = await (supabase as any)
      .from('markdown_proposals')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchError || !proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    if (proposal.status !== 'PENDING') {
      return NextResponse.json(
        { error: `Cannot reject proposal with status ${proposal.status}` },
        { status: 400 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rejectError } = await (supabase as any)
      .from('markdown_proposals')
      .update({ status: 'REJECTED', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (rejectError) {
      return NextResponse.json({ error: rejectError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

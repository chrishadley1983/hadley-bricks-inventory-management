import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceRoleClient();

    const { data: proposal, error: fetchError } = await supabase
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

    const { error: rejectError } = await supabase
      .from('markdown_proposals')
      .update({ status: 'REJECTED', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (rejectError) {
      return NextResponse.json({ error: rejectError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

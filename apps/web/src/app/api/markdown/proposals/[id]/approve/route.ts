import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { applyProposalLive } from '@/lib/markdown/apply.service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authClient = await createClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const supabase = createServiceRoleClient();

    // Fetch proposal
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase deep type inference workaround
    const { data: proposal, error: fetchError } = await (supabase as any)
      .from('markdown_proposals')
      .select('id, inventory_item_id, platform, proposed_action, proposed_price, status')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    if (proposal.status !== 'PENDING') {
      return NextResponse.json(
        { error: `Cannot approve proposal with status ${proposal.status}` },
        { status: 400 }
      );
    }

    // Push the price change LIVE to the platform (no-op for auctions).
    const result = await applyProposalLive(supabase, user.id, proposal);

    if (!result.success) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('markdown_proposals')
        .update({ status: 'FAILED', error_message: result.error, updated_at: new Date().toISOString() })
        .eq('id', id);
      return NextResponse.json({ error: `Failed to apply: ${result.error}` }, { status: 500 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: approveError } = await (supabase as any)
      .from('markdown_proposals')
      .update({
        status: 'APPROVED',
        pushed_to_platform: result.pushed,
        applied_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (approveError) {
      return NextResponse.json({ error: approveError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      action: proposal.proposed_action,
      pushedToPlatform: result.pushed,
    });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

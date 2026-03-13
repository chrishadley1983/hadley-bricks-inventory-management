import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceRoleClient();

    // Fetch proposal
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase deep type inference workaround
    const { data: proposal, error: fetchError } = await (supabase as any)
      .from('markdown_proposals')
      .select('id, inventory_item_id, proposed_action, proposed_price, status')
      .eq('id', id)
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

    // Apply the price change or flag for auction
    if (proposal.proposed_action === 'MARKDOWN' && proposal.proposed_price) {
      // Update inventory item price
      const { error: updateError } = await supabase
        .from('inventory_items')
        .update({
          listing_value: proposal.proposed_price,
          updated_at: new Date().toISOString(),
        })
        .eq('id', proposal.inventory_item_id);

      if (updateError) {
        // Mark proposal as FAILED
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from('markdown_proposals')
          .update({ status: 'FAILED', error_message: updateError.message, updated_at: new Date().toISOString() })
          .eq('id', id);

        return NextResponse.json({ error: `Failed to update item: ${updateError.message}` }, { status: 500 });
      }
    }

    // Mark proposal as approved
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: approveError } = await (supabase as any)
      .from('markdown_proposals')
      .update({ status: 'APPROVED', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (approveError) {
      return NextResponse.json({ error: approveError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, action: proposal.proposed_action });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

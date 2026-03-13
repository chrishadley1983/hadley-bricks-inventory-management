import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { z } from 'zod';

const bulkSchema = z.object({
  actions: z.array(
    z.object({
      id: z.string().uuid(),
      action: z.enum(['approve', 'reject']),
    })
  ),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = bulkSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const supabase = createServiceRoleClient();
    const results = { approved: 0, rejected: 0, failed: 0, errors: [] as string[] };

    for (const { id, action } of parsed.data.actions) {
      try {
        // Fetch proposal
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase deep type inference workaround
        const { data: proposal } = await (supabase as any)
          .from('markdown_proposals')
          .select('id, inventory_item_id, proposed_action, proposed_price, status')
          .eq('id', id)
          .eq('status', 'PENDING')
          .single();

        if (!proposal) {
          results.failed++;
          results.errors.push(`${id}: not found or not PENDING`);
          continue;
        }

        if (action === 'approve') {
          // Apply markdown price change
          if (proposal.proposed_action === 'MARKDOWN' && proposal.proposed_price) {
            const { error: updateError } = await supabase
              .from('inventory_items')
              .update({
                listing_value: proposal.proposed_price,
                updated_at: new Date().toISOString(),
              })
              .eq('id', proposal.inventory_item_id);

            if (updateError) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (supabase as any)
                .from('markdown_proposals')
                .update({ status: 'FAILED', error_message: updateError.message, updated_at: new Date().toISOString() })
                .eq('id', id);
              results.failed++;
              results.errors.push(`${id}: ${updateError.message}`);
              continue;
            }
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from('markdown_proposals')
            .update({ status: 'APPROVED', updated_at: new Date().toISOString() })
            .eq('id', id);
          results.approved++;
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from('markdown_proposals')
            .update({ status: 'REJECTED', updated_at: new Date().toISOString() })
            .eq('id', id);
          results.rejected++;
        }
      } catch (err) {
        results.failed++;
        results.errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return NextResponse.json({ success: true, ...results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

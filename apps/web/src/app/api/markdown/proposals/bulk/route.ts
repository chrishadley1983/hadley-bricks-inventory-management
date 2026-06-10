import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/api/require-user';
import { z } from 'zod';
import { applyProposalLive } from '@/lib/markdown/apply.service';

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
    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

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
          .select('id, inventory_item_id, platform, proposed_action, proposed_price, status')
          .eq('id', id)
          .eq('user_id', user.id)
          .eq('status', 'PENDING')
          .single();

        if (!proposal) {
          results.failed++;
          results.errors.push(`${id}: not found or not PENDING`);
          continue;
        }

        if (action === 'approve') {
          // Push the price change LIVE to the platform (no-op for auctions).
          const applyResult = await applyProposalLive(supabase, user.id, proposal);

          if (!applyResult.success) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
              .from('markdown_proposals')
              .update({ status: 'FAILED', error_message: applyResult.error, updated_at: new Date().toISOString() })
              .eq('id', id);
            results.failed++;
            results.errors.push(`${id}: ${applyResult.error}`);
            continue;
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from('markdown_proposals')
            .update({
              status: 'APPROVED',
              pushed_to_platform: applyResult.pushed,
              applied_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
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
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

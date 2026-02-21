/**
 * GET /api/arbitrage/vinted/automation/messages/pending
 *
 * Returns up to 20 pending seller messages and marks them as in_progress.
 * Also resets stale in_progress messages (>30 min) back to pending.
 *
 * Auth: X-Api-Key (vinted scanner config)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withApiKeyAuth } from '@/lib/middleware/vinted-api-auth';

interface PendingMessage {
  id: string;
  seller_username: string;
  message_text: string;
  order_reference: string;
  attempts: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function GET(request: NextRequest): Promise<NextResponse<any>> {
  return withApiKeyAuth<{ messages: PendingMessage[] }>(request, async (userId) => {
    const supabase = createServiceRoleClient();

    // 1. Reset stale in_progress messages (picked up >30 min ago, not yet sent)
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    await supabase
      .from('vinted_seller_messages')
      .update({
        status: 'pending',
        picked_up_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('status', 'in_progress')
      .lt('picked_up_at', thirtyMinAgo);

    // 2. Fetch up to 20 pending messages that haven't exceeded max attempts
    const { data: pending, error: fetchError } = await supabase
      .from('vinted_seller_messages')
      .select('id, seller_username, message_text, order_reference, attempts, max_attempts')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(20);

    if (fetchError) {
      console.error('[messages/pending] Fetch error:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
    }

    // Filter out messages that exceeded max attempts
    const eligible = (pending ?? []).filter((m) => m.attempts < m.max_attempts);

    if (eligible.length === 0) {
      return NextResponse.json({ messages: [] });
    }

    // 3. Mark them as in_progress
    const ids = eligible.map((m) => m.id);
    const now = new Date().toISOString();

    await supabase
      .from('vinted_seller_messages')
      .update({
        status: 'in_progress',
        picked_up_at: now,
        updated_at: now,
      })
      .in('id', ids);

    // 4. Return messages (without max_attempts - scanner doesn't need it)
    const messages: PendingMessage[] = eligible.map((m) => ({
      id: m.id,
      seller_username: m.seller_username,
      message_text: m.message_text,
      order_reference: m.order_reference,
      attempts: m.attempts,
    }));

    return NextResponse.json({ messages });
  });
}

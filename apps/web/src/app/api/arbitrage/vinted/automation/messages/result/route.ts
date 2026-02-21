/**
 * POST /api/arbitrage/vinted/automation/messages/result
 *
 * Reports the result of a seller message send attempt.
 * On success: marks as 'sent'.
 * On failure: increments attempts, marks as 'failed' if max reached, else back to 'pending'.
 * On CAPTCHA: pauses scanner (same as scan CAPTCHA behaviour).
 *
 * Auth: X-Api-Key (vinted scanner config)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withApiKeyAuth } from '@/lib/middleware/vinted-api-auth';

const ResultSchema = z.object({
  message_id: z.string().uuid(),
  success: z.boolean(),
  captcha_detected: z.boolean().optional().default(false),
  error: z.string().optional(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function POST(request: NextRequest): Promise<NextResponse<any>> {
  return withApiKeyAuth<{ updated: boolean }>(request, async (userId) => {
    const body = await request.json();
    const parsed = ResultSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { message_id, success, captcha_detected, error: errorMsg } = parsed.data;
    const supabase = createServiceRoleClient();
    const now = new Date().toISOString();

    // Verify the message belongs to this user and is in_progress
    const { data: message, error: fetchError } = await supabase
      .from('vinted_seller_messages')
      .select('id, attempts, max_attempts, status')
      .eq('id', message_id)
      .eq('user_id', userId)
      .single();

    if (fetchError || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    if (message.status !== 'in_progress') {
      return NextResponse.json(
        { error: `Message status is '${message.status}', expected 'in_progress'` },
        { status: 409 }
      );
    }

    // Handle CAPTCHA: pause scanner, leave message as in_progress (will reset via stale check)
    if (captcha_detected) {
      await supabase
        .from('vinted_scanner_config')
        .update({
          paused: true,
          pause_reason: 'CAPTCHA detected during seller messaging',
          captcha_detected_at: now,
          updated_at: now,
        })
        .eq('user_id', userId);

      // Reset this message back to pending so it can be retried after CAPTCHA resolved
      await supabase
        .from('vinted_seller_messages')
        .update({
          status: 'pending',
          picked_up_at: null,
          last_error: 'CAPTCHA detected',
          updated_at: now,
        })
        .eq('id', message_id);

      return NextResponse.json({ updated: true, captcha_paused: true });
    }

    if (success) {
      // Mark as sent
      await supabase
        .from('vinted_seller_messages')
        .update({
          status: 'sent',
          sent_at: now,
          attempts: message.attempts + 1,
          updated_at: now,
        })
        .eq('id', message_id);
    } else {
      // Increment attempts
      const newAttempts = message.attempts + 1;
      const newStatus = newAttempts >= message.max_attempts ? 'failed' : 'pending';

      await supabase
        .from('vinted_seller_messages')
        .update({
          status: newStatus,
          attempts: newAttempts,
          last_error: errorMsg || 'Unknown error',
          picked_up_at: null,
          updated_at: now,
        })
        .eq('id', message_id);
    }

    return NextResponse.json({ updated: true });
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';

/**
 * POST /api/inventory/ignore-link
 *
 * Mark (or un-mark) order line items as a conscious "won't link" decision.
 * Ignored items are excluded from the unlinked-resolution counts. The flag is
 * durable (lives on the line item, survives resolution-queue cleanup) and
 * reversible (pass ignore=false to restore).
 *
 *   source: 'ebay'    -> ebay_order_line_items
 *   source: 'amazon'  -> order_items (BrickLink/Brick Owl are excluded by rule)
 */
const Schema = z.object({
  source: z.enum(['ebay', 'amazon']),
  lineItemIds: z.array(z.string().uuid()).min(1).max(1000),
  ignore: z.boolean(),
  reason: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const parsed = Schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { source, lineItemIds, ignore, reason } = parsed.data;
    const table = source === 'ebay' ? 'ebay_order_line_items' : 'order_items';

    const patch = ignore
      ? {
          link_ignored: true,
          link_ignored_reason: reason ?? 'manual',
          link_ignored_at: new Date().toISOString(),
        }
      : {
          link_ignored: false,
          link_ignored_reason: null,
          link_ignored_at: null,
        };

    // RLS scopes the update to the authenticated user's rows.
    const { data, error } = await supabase
      .from(table)
      .update(patch)
      .in('id', lineItemIds)
      .select('id');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, updated: data?.length ?? 0 });
  } catch (error) {
    console.error('[POST /api/inventory/ignore-link] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

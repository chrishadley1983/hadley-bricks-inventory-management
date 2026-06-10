/**
 * POST /api/scanner/sessions/[sessionId]/link-inventory
 *
 * Bulk-links scanned pieces from a session to inventory items.
 *
 * Items with an inventory_item_id: counted as "updated" (already in inventory).
 * Items without one: create one new inventory_items record per unit (quantity × inserts).
 *
 * Returns { created: number, updated: number }.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';

export const runtime = 'nodejs';
export const maxDuration = 30;

const LinkItemSchema = z.object({
  part_id: z.string().min(1),
  part_name: z.string(),
  category: z.string(),
  quantity: z.number().int().positive(),
  inventory_item_id: z.string().uuid().optional(),
});

const LinkInventoryBodySchema = z.object({
  items: z.array(LinkItemSchema).min(1, 'At least one item is required'),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const { sessionId } = await params;

    // Verify session belongs to the user
    const { data: session, error: sessionError } = await supabase
      .from('scanner_sessions')
      .select('id, user_id, status')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if ((session as { id: string; user_id: string; status: string }).user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = LinkInventoryBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { items } = parsed.data;

    let created = 0;
    let updated = 0;
    const failed: Array<{ part_id: string; reason: string }> = [];

    for (const item of items) {
      if (item.inventory_item_id) {
        // Item is already mapped to an existing inventory record — verify it belongs to user
        const { data: invItem, error: invErr } = await supabase
          .from('inventory_items')
          .select('id')
          .eq('id', item.inventory_item_id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (!invErr && invItem) {
          updated++;
        } else {
          failed.push({
            part_id: item.part_id,
            reason: invErr?.message ?? 'Inventory item not found or not owned by user',
          });
        }
      } else {
        // No match — create one inventory record per unit
        const inserts = Array.from({ length: item.quantity }, () => ({
          user_id: user.id,
          set_number: item.part_id,
          item_name: item.part_name || item.part_id,
          condition: 'Used' as const,
          status: 'BACKLOG',
          notes: item.category ? `Category: ${item.category}` : null,
        }));

        const { error: insertError } = await supabase.from('inventory_items').insert(inserts);

        if (!insertError) {
          created += item.quantity;
        } else {
          failed.push({ part_id: item.part_id, reason: insertError.message });
        }
      }
    }

    return NextResponse.json({ data: { created, updated, failed } });
  } catch (error) {
    console.error('[POST /api/scanner/sessions/[sessionId]/link-inventory]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

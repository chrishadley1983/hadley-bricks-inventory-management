/**
 * POST /api/scanner/pieces/[pieceId]/link
 *
 * Links a single scanner piece to an existing inventory item.
 * Updates scanner_pieces.inventory_item_id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';
import { ScannerRepository } from '@/lib/repositories/scanner.repository';

export const runtime = 'nodejs';
export const maxDuration = 30;

const LinkBodySchema = z.object({
  inventory_item_id: z.string().uuid('inventory_item_id must be a valid UUID'),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pieceId: string }> }
) {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const { pieceId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = LinkBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { inventory_item_id } = parsed.data;

    // Verify the inventory item exists and belongs to the user
    const { data: invItem, error: invError } = await supabase
      .from('inventory_items')
      .select('id')
      .eq('id', inventory_item_id)
      .eq('user_id', user.id)
      .single();

    if (invError || !invItem) {
      return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 });
    }

    // scanner_pieces is not in the strict Database type so we cast to any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Verify the piece exists
    const { data: pieceData, error: pErr } = await sb
      .from('scanner_pieces')
      .select('id, session_id')
      .eq('id', pieceId)
      .single();

    if (pErr || !pieceData) {
      return NextResponse.json({ error: 'Scanner piece not found' }, { status: 404 });
    }

    // Verify session belongs to user
    const { data: sessionRow, error: sErr } = await supabase
      .from('scanner_sessions')
      .select('id, user_id')
      .eq('id', pieceData.session_id)
      .single();

    if (
      sErr ||
      !sessionRow ||
      (sessionRow as { id: string; user_id: string }).user_id !== user.id
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Link the piece to the inventory item
    const { error: updateError } = await sb
      .from('scanner_pieces')
      .update({ inventory_item_id })
      .eq('id', pieceId);

    if (updateError) {
      throw new Error(`Failed to link piece: ${updateError.message}`);
    }

    // Return the updated piece via the scanner repo
    const repo = new ScannerRepository(supabase);
    const { data: pieces } = await repo.findPiecesBySessionId(pieceData.session_id, undefined, {
      page: 1,
      pageSize: 1000,
    });
    const updatedPiece = pieces.find((p) => p.id === pieceId) ?? null;

    return NextResponse.json({ data: updatedPiece });
  } catch (error) {
    console.error('[POST /api/scanner/pieces/[pieceId]/link]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

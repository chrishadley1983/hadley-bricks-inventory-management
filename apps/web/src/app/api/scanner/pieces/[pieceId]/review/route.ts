/**
 * PATCH /api/scanner/pieces/[pieceId]/review
 *
 * Marks a scanner piece as reviewed, recording the confirmed BrickLink item ID
 * and the reviewer's accept/reject decision.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';
import { ScannerRepository } from '@/lib/repositories/scanner.repository';

export const runtime = 'nodejs';
export const maxDuration = 30;

const ReviewBodySchema = z.object({
  reviewed_item_id: z.string().min(1, 'reviewed_item_id is required'),
  status: z.enum(['accepted', 'rejected']),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ pieceId: string }> }
) {
  try {
    const { supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const { pieceId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = ReviewBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { reviewed_item_id, status } = parsed.data;

    const repo = new ScannerRepository(supabase);
    const updatedPiece = await repo.updatePieceReview(pieceId, reviewed_item_id, status);

    return NextResponse.json({ data: updatedPiece });
  } catch (error) {
    console.error('[PATCH /api/scanner/pieces/[pieceId]/review]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

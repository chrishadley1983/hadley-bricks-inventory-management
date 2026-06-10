/**
 * GET /api/scanner/sessions/[sessionId]
 *
 * Returns a scanner session with its pieces (filtered/paginated) and piece counts
 * broken down by status (including 'all'). Piece filtering and pagination params
 * can be passed as query params: pieceStatus, piecePage, piecePageSize.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';
import { ScannerRepository } from '@/lib/repositories/scanner.repository';

export const runtime = 'nodejs';
export const maxDuration = 30;

const QuerySchema = z.object({
  pieceStatus: z.string().optional(),
  piecePage: z.coerce.number().int().positive().optional().default(1),
  piecePageSize: z.coerce.number().int().min(1).max(500).optional().default(100),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const { sessionId } = await params;

    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());
    const parsed = QuerySchema.safeParse(queryParams);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { pieceStatus, piecePage, piecePageSize } = parsed.data;

    const repo = new ScannerRepository(supabase);

    const session = await repo.findSessionById(sessionId, user.id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Fetch the requested page of pieces (filtered by status if provided)
    const piecesResult = await repo.findPiecesBySessionId(
      sessionId,
      { status: pieceStatus },
      { page: piecePage, pageSize: piecePageSize }
    );

    // Build per-status counts using exact count queries — avoids the 1000-row fetch limit.
    // Use repo's internal supabase (already cast to any) via helper on the repo instance.
    const [
      { count: acceptedCount },
      { count: flaggedCount },
      { count: rejectedCount },
      { count: errorCount },
      { count: totalCount },
    ] = await Promise.all([
      repo.countPiecesByStatus(sessionId, 'accepted'),
      repo.countPiecesByStatus(sessionId, 'flagged'),
      repo.countPiecesByStatus(sessionId, 'rejected'),
      repo.countPiecesByStatus(sessionId, 'error'),
      repo.countPiecesByStatus(sessionId),
    ]);

    return NextResponse.json({
      data: {
        session,
        pieces: piecesResult.data,
        pieceTotal: piecesResult.total,
        pieceCounts: {
          all: totalCount ?? 0,
          accepted: acceptedCount ?? 0,
          flagged: flaggedCount ?? 0,
          rejected: rejectedCount ?? 0,
          error: errorCount ?? 0,
        },
      },
    });
  } catch (error) {
    console.error('[GET /api/scanner/sessions/[sessionId]]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

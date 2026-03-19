/**
 * GET /api/scanner/sessions/[sessionId]/pieces
 *
 * Returns a paginated list of pieces for a scanner session,
 * with optional status filter.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ScannerRepository } from '@/lib/repositories/scanner.repository';

export const runtime = 'nodejs';
export const maxDuration = 30;

const QuerySchema = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(500).optional().default(100),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

    const { status, page, pageSize } = parsed.data;

    const repo = new ScannerRepository(supabase);

    // Verify session exists
    const session = await repo.findSessionById(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const result = await repo.findPiecesBySessionId(sessionId, { status }, { page, pageSize });

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[GET /api/scanner/sessions/[sessionId]/pieces]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

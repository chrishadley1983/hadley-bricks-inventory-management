/**
 * GET /api/scanner/sessions
 *
 * Returns a paginated list of scanner sessions for the authenticated user.
 * Response shape: { data: { sessions, total, page, pageSize, totalPages } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';
import { ScannerRepository } from '@/lib/repositories/scanner.repository';

export const runtime = 'nodejs';
export const maxDuration = 30;

const QuerySchema = z.object({
  status: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export async function GET(request: NextRequest) {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());
    const parsed = QuerySchema.safeParse(queryParams);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { status, dateFrom, dateTo, search, page, pageSize } = parsed.data;

    const repo = new ScannerRepository(supabase);
    const result = await repo.findSessions(
      user.id,
      { status, dateFrom, dateTo, search },
      { page, pageSize }
    );

    // result already has the { sessions, total, page, pageSize, totalPages } shape
    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[GET /api/scanner/sessions]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

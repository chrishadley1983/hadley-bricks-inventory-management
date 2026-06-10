/**
 * GET /api/scanner/set-check
 *
 * Returns a paginated list of set-check sessions for the authenticated user,
 * joined with scanner_sessions for status and dates.
 * Response shape: { data: { sessions, total, page, pageSize, totalPages } }
 */

// TODO: Refactor to use ScannerRepository — set-check queries currently bypass the
// repository pattern and query Supabase directly. Extract into a SetCheckRepository
// or extend ScannerRepository with set-check methods.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';

export const runtime = 'nodejs';
export const maxDuration = 30;

const QuerySchema = z.object({
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

    const { page, pageSize } = parsed.data;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Fetch set-check sessions joined with scanner_sessions filtered to this user
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: sessions, error, count } = await (supabase as any)
      .from('scanner_set_check_sessions')
      .select(
        `
        id,
        session_id,
        set_num,
        set_name,
        set_year,
        total_expected,
        total_unique,
        spare_count,
        parts_json,
        created_at,
        scanner_sessions!inner(
          status,
          started_at,
          ended_at,
          user_id
        )
        `,
        { count: 'exact' }
      )
      .eq('scanner_sessions.user_id', user.id)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      console.error('[GET /api/scanner/set-check] DB error:', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    // Flatten joined scanner_sessions fields
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flatSessions = (sessions ?? []).map((row: any) => ({
      id: row.id,
      session_id: row.session_id,
      set_num: row.set_num,
      set_name: row.set_name,
      set_year: row.set_year,
      total_expected: row.total_expected,
      total_unique: row.total_unique,
      spare_count: row.spare_count,
      parts_json: row.parts_json,
      created_at: row.created_at,
      status: row.scanner_sessions?.status ?? null,
      started_at: row.scanner_sessions?.started_at ?? null,
      ended_at: row.scanner_sessions?.ended_at ?? null,
    }));

    const total = count ?? 0;
    const totalPages = Math.ceil(total / pageSize);

    return NextResponse.json({
      data: {
        sessions: flatSessions,
        total,
        page,
        pageSize,
        totalPages,
      },
    });
  } catch (error) {
    console.error('[GET /api/scanner/set-check]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

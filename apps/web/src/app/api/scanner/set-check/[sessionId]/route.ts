/**
 * GET /api/scanner/set-check/[sessionId]
 *
 * Returns a set-check session with all its progress rows.
 * Response shape: { data: { session, progress } }
 */

// TODO: Refactor to use ScannerRepository — set-check queries currently bypass the
// repository pattern and query Supabase directly. Extract into a SetCheckRepository
// or extend ScannerRepository with set-check methods.

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const { sessionId } = await params;

    // Fetch the set-check session, ensuring it belongs to this user via scanner_sessions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: sessionRows, error: sessionError } = await (supabase as any)
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
        `
      )
      .eq('id', sessionId)
      .eq('scanner_sessions.user_id', user.id)
      .limit(1);

    if (sessionError) {
      console.error('[GET /api/scanner/set-check/[sessionId]] DB error:', sessionError);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    if (!sessionRows || sessionRows.length === 0) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const row = sessionRows[0];
    const session = {
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
    };

    // Fetch all progress rows for this set-check session
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: progress, error: progressError } = await (supabase as any)
      .from('scanner_set_check_progress')
      .select('*')
      .eq('set_check_session_id', sessionId)
      .order('part_num', { ascending: true });

    if (progressError) {
      console.error('[GET /api/scanner/set-check/[sessionId]] Progress DB error:', progressError);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        session,
        progress: progress ?? [],
      },
    });
  } catch (error) {
    console.error('[GET /api/scanner/set-check/[sessionId]]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

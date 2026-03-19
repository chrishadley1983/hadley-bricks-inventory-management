/**
 * GET /api/scanner/sessions/active
 *
 * Returns the currently active scanner session (status: scanning, calibrating, or paused),
 * or null if no session is active.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ScannerRepository } from '@/lib/repositories/scanner.repository';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const repo = new ScannerRepository(supabase);
    const session = await repo.findActiveSession();

    return NextResponse.json({ data: session });
  } catch (error) {
    console.error('[GET /api/scanner/sessions/active]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

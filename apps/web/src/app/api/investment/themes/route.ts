/**
 * GET /api/investment/themes
 *
 * Returns distinct theme values from brickset_sets for the theme filter dropdown.
 * Paginates through all rows (>1000) and deduplicates in JS.
 */

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { fetchAllRecords } from '@/lib/supabase/pagination';

export async function GET() {
  try {
    const supabase = createServiceRoleClient();

    const rows = await fetchAllRecords(supabase, 'brickset_sets', {
      select: 'theme',
      isNotNull: ['theme'],
    });

    const themeSet = new Set<string>();
    for (const row of rows) {
      const theme = (row as Record<string, unknown>).theme as string;
      if (theme) themeSet.add(theme);
    }

    const themes = [...themeSet].sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ themes });
  } catch (error) {
    console.error('[GET /api/investment/themes] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/investment/themes
 *
 * Returns distinct theme values from brickset_sets for the theme filter dropdown.
 * Paginates through all rows (>1000) and deduplicates in JS.
 */

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createServiceRoleClient();

    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    const themeSet = new Set<string>();

    while (hasMore) {
      const { data, error } = await supabase
        .from('brickset_sets')
        .select('theme')
        .not('theme', 'is', null)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.error('[GET /api/investment/themes] Query error:', error.message);
        return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
      }

      for (const row of data ?? []) {
        const theme = (row as Record<string, unknown>).theme as string;
        if (theme) themeSet.add(theme);
      }

      hasMore = (data?.length ?? 0) === pageSize;
      page++;
    }

    const themes = [...themeSet].sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ themes });
  } catch (error) {
    console.error('[GET /api/investment/themes] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

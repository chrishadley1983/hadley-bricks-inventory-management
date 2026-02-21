/**
 * Export Multiple ASIN Matches to CSV
 *
 * GET - Exports all seeded ASINs with 'multiple' status to CSV
 *       Includes set number, set name, each ASIN option, and sales rank
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

interface AlternativeAsin {
  asin: string;
  title: string;
  confidence: number;
}

interface SeededAsinRow {
  id: string;
  asin: string | null;
  alternative_asins: AlternativeAsin[] | null;
  match_confidence: number | null;
  amazon_title: string | null;
  brickset_sets: {
    set_number: string;
    set_name: string;
    theme: string | null;
    year_from: number | null;
  };
}

interface SalesRankRow {
  asin: string;
  sales_rank: number | null;
}

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check auth
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service role to read all data
    const serviceClient = createServiceRoleClient();

    // Fetch all seeded ASINs with 'multiple' status
    const { data: multiples, error: fetchError } = await serviceClient
      .from('seeded_asins')
      .select(
        `
        id,
        asin,
        alternative_asins,
        match_confidence,
        amazon_title,
        brickset_sets!inner (
          set_number,
          set_name,
          theme,
          year_from
        )
      `
      )
      .eq('discovery_status', 'multiple')
      .order('created_at', { ascending: false });

    if (fetchError) {
      console.error('[GET /api/arbitrage/seeded/export-multiples] Fetch error:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch multiple matches' }, { status: 500 });
    }

    if (!multiples || multiples.length === 0) {
      return NextResponse.json({ error: 'No multiple matches found' }, { status: 404 });
    }

    // Collect all unique ASINs to look up sales ranks
    const allAsins = new Set<string>();
    for (const row of multiples as SeededAsinRow[]) {
      if (row.asin) allAsins.add(row.asin);
      if (row.alternative_asins) {
        for (const alt of row.alternative_asins) {
          allAsins.add(alt.asin);
        }
      }
    }

    // Fetch sales ranks for all ASINs from amazon_arbitrage_pricing (most recent snapshot)
    const salesRankMap = new Map<string, number | null>();

    if (allAsins.size > 0) {
      // Get the most recent sales rank for each ASIN
      const { data: rankings } = await serviceClient
        .from('amazon_arbitrage_pricing')
        .select('asin, sales_rank')
        .in('asin', Array.from(allAsins))
        .not('sales_rank', 'is', null)
        .order('snapshot_date', { ascending: false });

      if (rankings) {
        // Only keep the first (most recent) entry for each ASIN
        for (const rank of rankings as SalesRankRow[]) {
          if (!salesRankMap.has(rank.asin)) {
            salesRankMap.set(rank.asin, rank.sales_rank);
          }
        }
      }
    }

    // Build CSV rows
    const csvRows: string[] = [];

    // Header
    csvRows.push('Set Number,Set Name,Theme,Year,ASIN,ASIN Title,Confidence,Sales Rank,Is Primary');

    // Data rows - group all ASINs for each set together
    for (const row of multiples as SeededAsinRow[]) {
      const bs = row.brickset_sets;
      const setNumber = escapeCsvField(bs.set_number);
      const setName = escapeCsvField(bs.set_name);
      const theme = escapeCsvField(bs.theme ?? '');
      const year = bs.year_from?.toString() ?? '';

      // Primary ASIN (if exists)
      if (row.asin) {
        const salesRank = salesRankMap.get(row.asin) ?? '';
        csvRows.push(
          [
            setNumber,
            setName,
            theme,
            year,
            row.asin,
            escapeCsvField(row.amazon_title ?? ''),
            row.match_confidence?.toString() ?? '',
            salesRank.toString(),
            'Yes',
          ].join(',')
        );
      }

      // Alternative ASINs
      if (row.alternative_asins) {
        for (const alt of row.alternative_asins) {
          const salesRank = salesRankMap.get(alt.asin) ?? '';
          csvRows.push(
            [
              setNumber,
              setName,
              theme,
              year,
              alt.asin,
              escapeCsvField(alt.title ?? ''),
              alt.confidence?.toString() ?? '',
              salesRank.toString(),
              'No',
            ].join(',')
          );
        }
      }
    }

    const csvContent = csvRows.join('\n');
    const filename = `seeded-multiples-${new Date().toISOString().split('T')[0]}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[GET /api/arbitrage/seeded/export-multiples] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Escape a field for CSV format
 */
function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

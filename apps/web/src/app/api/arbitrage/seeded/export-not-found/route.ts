/**
 * Export Not Found ASINs to CSV
 *
 * GET - Exports all seeded ASINs with 'not_found' status to CSV
 *       Includes set number, set name, theme, year, EAN, UPC
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

interface SeededAsinRow {
  id: string;
  discovery_attempts: number;
  last_discovery_attempt_at: string | null;
  discovery_error: string | null;
  brickset_sets: {
    set_number: string;
    set_name: string;
    theme: string | null;
    year_from: number | null;
    ean: string | null;
    upc: string | null;
    uk_retail_price: number | null;
    pieces: number | null;
  };
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

    // Fetch all seeded ASINs with 'not_found' status
    const { data: notFoundItems, error: fetchError } = await serviceClient
      .from('seeded_asins')
      .select(`
        id,
        discovery_attempts,
        last_discovery_attempt_at,
        discovery_error,
        brickset_sets!inner (
          set_number,
          set_name,
          theme,
          year_from,
          ean,
          upc,
          uk_retail_price,
          pieces
        )
      `)
      .eq('discovery_status', 'not_found')
      .order('created_at', { ascending: false });

    if (fetchError) {
      console.error('[GET /api/arbitrage/seeded/export-not-found] Fetch error:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch not found items' },
        { status: 500 }
      );
    }

    if (!notFoundItems || notFoundItems.length === 0) {
      return NextResponse.json(
        { error: 'No not found items' },
        { status: 404 }
      );
    }

    // Build CSV rows
    const csvRows: string[] = [];

    // Header
    csvRows.push('Set Number,Set Name,Theme,Year,RRP,Pieces,EAN,UPC,Discovery Attempts,Last Attempt,Error');

    // Data rows
    for (const row of notFoundItems as SeededAsinRow[]) {
      const bs = row.brickset_sets;
      csvRows.push([
        escapeCsvField(bs.set_number),
        escapeCsvField(bs.set_name),
        escapeCsvField(bs.theme ?? ''),
        bs.year_from?.toString() ?? '',
        bs.uk_retail_price?.toFixed(2) ?? '',
        bs.pieces?.toString() ?? '',
        escapeCsvField(bs.ean ?? ''),
        escapeCsvField(bs.upc ?? ''),
        row.discovery_attempts.toString(),
        row.last_discovery_attempt_at ? new Date(row.last_discovery_attempt_at).toISOString().split('T')[0] : '',
        escapeCsvField(row.discovery_error ?? ''),
      ].join(','));
    }

    const csvContent = csvRows.join('\n');
    const filename = `seeded-not-found-${new Date().toISOString().split('T')[0]}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[GET /api/arbitrage/seeded/export-not-found] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
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

/**
 * Import Barcodes from CSV API Route
 *
 * POST - Import EAN/UPC data from Brickset CSV export file
 *
 * Expects the CSV to have columns: Number, Variant, EAN, UPC
 * Updates brickset_sets table where EAN or UPC is missing
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { promises as fs } from 'fs';
import path from 'path';

interface CsvRow {
  setNumber: string;
  ean: string | null;
  upc: string | null;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export async function POST(request: NextRequest) {
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

    // Parse body for options
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun === true;
    const limit = Math.min(body.limit || 10000, 50000);

    // Read the CSV file
    const csvPath = path.join(process.cwd(), '..', '..', 'docs', 'Brickset-allSets.csv');
    let csvContent: string;
    try {
      csvContent = await fs.readFile(csvPath, 'utf-8');
    } catch {
      return NextResponse.json(
        { error: `CSV file not found at ${csvPath}` },
        { status: 404 }
      );
    }

    // Parse CSV
    const lines = csvContent.split('\n');
    const headerLine = lines[0];
    const headers = parseCSVLine(headerLine);

    // Find column indices
    const numberIdx = headers.findIndex((h) => h === 'Number');
    const variantIdx = headers.findIndex((h) => h === 'Variant');
    const eanIdx = headers.findIndex((h) => h === 'EAN');
    const upcIdx = headers.findIndex((h) => h === 'UPC');

    if (numberIdx === -1 || variantIdx === -1 || eanIdx === -1 || upcIdx === -1) {
      return NextResponse.json(
        {
          error: 'CSV missing required columns',
          found: { numberIdx, variantIdx, eanIdx, upcIdx },
          headers: headers.slice(0, 30),
        },
        { status: 400 }
      );
    }

    // Parse all rows with EAN or UPC data
    const barcodeData: CsvRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = parseCSVLine(line);
      const number = cols[numberIdx];
      const variant = cols[variantIdx];
      const ean = cols[eanIdx] || null;
      const upc = cols[upcIdx] || null;

      // Skip if no barcode data
      if (!ean && !upc) continue;

      // Validate EAN (should be 13 digits) and UPC (should be 12 digits)
      const validEan = ean && /^\d{13}$/.test(ean) ? ean : null;
      const validUpc = upc && /^\d{12}$/.test(upc) ? upc : null;

      if (!validEan && !validUpc) continue;

      const setNumber = `${number}-${variant}`;
      barcodeData.push({ setNumber, ean: validEan, upc: validUpc });
    }

    console.log(`[import-barcodes-csv] Parsed ${barcodeData.length} sets with barcode data from CSV`);

    // Get sets that need updating (missing EAN or UPC)
    // IMPORTANT: Supabase returns max 1000 rows by default, so we paginate
    const serviceClient = createServiceRoleClient();
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    const setsToUpdate: Array<{ id: string; set_number: string; ean: string | null; upc: string | null }> = [];

    console.log(`[import-barcodes-csv] Fetching sets with missing barcodes (limit: ${limit})...`);

    while (hasMore && setsToUpdate.length < limit) {
      const { data, error: queryError } = await serviceClient
        .from('brickset_sets')
        .select('id, set_number, ean, upc')
        .or('ean.is.null,upc.is.null')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (queryError) {
        console.error('[import-barcodes-csv] Query error:', queryError);
        return NextResponse.json({ error: 'Failed to query sets' }, { status: 500 });
      }

      setsToUpdate.push(...(data ?? []));
      hasMore = (data?.length ?? 0) === pageSize;
      page++;

      console.log(`[import-barcodes-csv] Page ${page}: fetched ${data?.length ?? 0} sets, total: ${setsToUpdate.length}`);
    }

    // Trim to limit if we fetched more
    if (setsToUpdate.length > limit) {
      setsToUpdate.length = limit;
    }

    console.log(`[import-barcodes-csv] Total sets needing update: ${setsToUpdate.length}`);

    // Create lookup map from CSV data
    const barcodeMap = new Map<string, { ean: string | null; upc: string | null }>();
    for (const row of barcodeData) {
      barcodeMap.set(row.setNumber, { ean: row.ean, upc: row.upc });
    }

    // Find matches and prepare updates
    const updates: Array<{ id: string; setNumber: string; ean?: string; upc?: string }> = [];
    for (const set of setsToUpdate || []) {
      const csvData = barcodeMap.get(set.set_number);
      if (!csvData) continue;

      const update: { id: string; setNumber: string; ean?: string; upc?: string } = {
        id: set.id,
        setNumber: set.set_number,
      };

      // Only update if CSV has data and DB is missing it
      if (csvData.ean && !set.ean) {
        update.ean = csvData.ean;
      }
      if (csvData.upc && !set.upc) {
        update.upc = csvData.upc;
      }

      // Only add if there's something to update
      if (update.ean || update.upc) {
        updates.push(update);
      }
    }

    console.log(`[import-barcodes-csv] Found ${updates.length} sets to update`);

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        message: `Would update ${updates.length} sets`,
        csvRowsWithBarcodes: barcodeData.length,
        setsNeedingUpdate: setsToUpdate?.length || 0,
        matchedSets: updates.length,
        sampleUpdates: updates.slice(0, 20).map((u) => ({
          setNumber: u.setNumber,
          newEan: u.ean || null,
          newUpc: u.upc || null,
        })),
      });
    }

    // Apply updates in batches
    let updated = 0;
    let failed = 0;
    const batchSize = 100;

    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);

      for (const update of batch) {
        const updateData: Record<string, string> = {};
        if (update.ean) updateData.ean = update.ean;
        if (update.upc) updateData.upc = update.upc;

        const { error: updateError } = await serviceClient
          .from('brickset_sets')
          .update(updateData)
          .eq('id', update.id);

        if (updateError) {
          console.error(`[import-barcodes-csv] Failed to update ${update.setNumber}:`, updateError);
          failed++;
        } else {
          updated++;
        }
      }

      // Log progress
      if ((i + batchSize) % 1000 === 0 || i + batchSize >= updates.length) {
        console.log(`[import-barcodes-csv] Progress: ${Math.min(i + batchSize, updates.length)}/${updates.length}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Updated ${updated} sets, ${failed} failed`,
      stats: {
        csvRowsWithBarcodes: barcodeData.length,
        setsNeedingUpdate: setsToUpdate?.length || 0,
        matchedSets: updates.length,
        updated,
        failed,
      },
    });
  } catch (error) {
    console.error('[POST /api/admin/brickset/import-barcodes-csv] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

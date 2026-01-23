import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import JSZip from 'jszip';
import { createClient } from '@/lib/supabase/server';
import { MtdExportService } from '@/lib/services/mtd-export.service';
import { QuickFileService } from '@/lib/services/quickfile.service';
import { CredentialsRepository } from '@/lib/repositories';
import type { QuickFileCredentials } from '@/types/mtd-export';

const ExportSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format'),
  action: z.enum(['csv', 'quickfile']),
});

const PreviewSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format'),
});

/**
 * GET /api/reports/mtd-export?month=YYYY-MM
 * Get export preview for confirmation dialog
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const month = searchParams.get('month');

    const parsed = PreviewSchema.safeParse({ month });
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const mtdService = new MtdExportService(supabase);
    const preview = await mtdService.generateExportPreview(user.id, parsed.data.month);

    return NextResponse.json(preview);
  } catch (error) {
    console.error('[GET /api/reports/mtd-export] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/reports/mtd-export
 * Export data for MTD (CSV download or QuickFile push)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = ExportSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { month, action } = parsed.data;
    const mtdService = new MtdExportService(supabase);

    // Generate CSV data
    const csvData = await mtdService.generateCsvData(user.id, month);

    // Check for empty data
    if (csvData.sales.length === 0 && csvData.expenses.length === 0) {
      const monthLabel = new Date(month + '-01').toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
      });
      return NextResponse.json(
        { error: `No data to export for ${monthLabel}`, isEmpty: true },
        { status: 400 }
      );
    }

    if (action === 'csv') {
      // Generate CSV files
      const salesCsv = mtdService.generateSalesCsv(csvData);
      const expensesCsv = mtdService.generateExpensesCsv(csvData);

      // Create ZIP with both files
      const zip = new JSZip();
      zip.file(`quickfile-${month}-sales.csv`, salesCsv);
      zip.file(`quickfile-${month}-expenses.csv`, expensesCsv);

      const zipBlob = await zip.generateAsync({ type: 'arraybuffer' });

      // Log the export
      const entriesCount = csvData.sales.length + csvData.expenses.length;
      await mtdService.logExport(user.id, month, 'csv', entriesCount);

      // Return ZIP file
      return new NextResponse(zipBlob, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="quickfile-${month}.zip"`,
        },
      });
    }

    // QuickFile API push
    if (action === 'quickfile') {
      // Get QuickFile credentials
      const credentialsRepo = new CredentialsRepository(supabase);
      const credentials = await credentialsRepo.getCredentials<QuickFileCredentials>(
        user.id,
        'quickfile'
      );

      if (!credentials) {
        return NextResponse.json(
          { error: 'QuickFile credentials not configured', needsCredentials: true },
          { status: 400 }
        );
      }

      // Push to QuickFile with timeout
      const quickFileService = new QuickFileService(credentials);

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('QuickFile connection timed out. Please try again.')), 30000);
      });

      try {
        const result = await Promise.race([
          quickFileService.pushMtdData(csvData.sales, csvData.expenses),
          timeoutPromise,
        ]);

        if (!result.success && result.errors.length > 0) {
          return NextResponse.json(
            {
              success: false,
              error: `QuickFile error: ${result.errors[0]}`,
              errors: result.errors,
            },
            { status: 400 }
          );
        }

        // Log successful export
        const entriesCount = result.invoicesCreated + result.purchasesCreated;
        await mtdService.logExport(user.id, month, 'quickfile', entriesCount, {
          invoicesCreated: result.invoicesCreated,
          purchasesCreated: result.purchasesCreated,
        });

        return NextResponse.json({
          success: true,
          invoicesCreated: result.invoicesCreated,
          purchasesCreated: result.purchasesCreated,
          message: `Exported ${result.invoicesCreated} invoices and ${result.purchasesCreated} purchases to QuickFile`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';

        // Handle specific error types
        if (message.includes('timed out')) {
          return NextResponse.json(
            { error: 'QuickFile connection timed out. Please try again.' },
            { status: 504 }
          );
        }

        if (message.includes('401') || message.toLowerCase().includes('unauthorized') || message.toLowerCase().includes('invalid')) {
          return NextResponse.json(
            { error: 'Invalid QuickFile credentials. Please check your Account Number and API Key.' },
            { status: 401 }
          );
        }

        return NextResponse.json(
          { error: `QuickFile error: ${message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[POST /api/reports/mtd-export] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

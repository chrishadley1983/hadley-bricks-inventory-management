import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSheetsClient } from '@/lib/google';
import { createMigrationService } from '@/lib/migration';

const RunMigrationSchema = z.object({
  dryRun: z.boolean().optional().default(true),
  limit: z.number().optional(),
  type: z.enum(['inventory', 'purchases', 'all']).optional().default('inventory'),
});

/**
 * POST /api/admin/migration/run
 * Run migration from Google Sheets to Supabase
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse and validate request body
    const body = await request.json();
    const parsed = RunMigrationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { dryRun, limit, type } = parsed.data;

    // Create migration service
    const sheetsClient = getSheetsClient();
    const migrationService = createMigrationService(sheetsClient);

    // Run migration
    const options = {
      dryRun,
      limit,
      userId: user.id,
      updateExisting: false,
    };

    let result;
    if (type === 'inventory' || type === 'all') {
      result = await migrationService.migrateInventory(options);
    } else if (type === 'purchases') {
      result = await migrationService.migratePurchases(options);
    }

    return NextResponse.json({
      success: true,
      dryRun,
      totalSuccess: result?.totalSuccess ?? 0,
      totalErrors: result?.totalErrors ?? 0,
      totalSkipped: result?.totalSkipped ?? 0,
      duration: result?.duration ?? 0,
      sheets: result?.sheets.map((s) => ({
        name: s.sheetName,
        processed: s.totalRows,
        success: s.successCount,
        errors: s.errorCount,
        skipped: s.skippedCount,
      })),
    });
  } catch (error) {
    console.error('[POST /api/admin/migration/run] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Migration failed', details: message },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ProfitLossReportService } from '@/lib/services/profit-loss-report.service';

/**
 * GET /api/reports/profit-loss-detailed
 *
 * Generate a detailed Profit & Loss report with monthly breakdown.
 *
 * Query Parameters:
 * - startMonth: string (YYYY-MM) - Start of date range (optional, defaults to earliest data)
 * - endMonth: string (YYYY-MM) - End of date range (optional, defaults to current month)
 * - includeZeroRows: boolean - Include rows with all zero values (optional, defaults to false)
 */
export async function GET(request: NextRequest) {
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

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const startMonth = searchParams.get('startMonth') || undefined;
    const endMonth = searchParams.get('endMonth') || undefined;
    const includeZeroRows = searchParams.get('includeZeroRows') === 'true';

    // Validate month format if provided
    const monthPattern = /^\d{4}-\d{2}$/;
    if (startMonth && !monthPattern.test(startMonth)) {
      return NextResponse.json(
        { error: 'Invalid startMonth format. Expected YYYY-MM' },
        { status: 400 }
      );
    }
    if (endMonth && !monthPattern.test(endMonth)) {
      return NextResponse.json(
        { error: 'Invalid endMonth format. Expected YYYY-MM' },
        { status: 400 }
      );
    }

    // Generate report
    const reportService = new ProfitLossReportService(supabase);
    const report = await reportService.generateReport(user.id, {
      startMonth,
      endMonth,
      includeZeroRows,
    });

    return NextResponse.json({ data: report });
  } catch (error) {
    console.error('[GET /api/reports/profit-loss-detailed] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to generate profit/loss report', details: message },
      { status: 500 }
    );
  }
}

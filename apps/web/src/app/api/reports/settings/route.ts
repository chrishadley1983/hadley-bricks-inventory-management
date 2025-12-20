import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ReportingService } from '@/lib/services';

const UpdateSettingsSchema = z.object({
  financialYearStartMonth: z.number().min(1).max(12).optional(),
  defaultCurrency: z.string().optional(),
  mileageRate: z.number().positive().optional(),
  businessName: z.string().nullable().optional(),
  businessAddress: z.string().nullable().optional(),
  showPreviousPeriodComparison: z.boolean().optional(),
});

/**
 * GET /api/reports/settings
 * Get user's report settings
 */
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const reportingService = new ReportingService(supabase);
    const settings = await reportingService.getReportSettings(user.id);

    return NextResponse.json({ data: settings });
  } catch (error) {
    console.error('[GET /api/reports/settings] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/reports/settings
 * Update user's report settings
 */
export async function PUT(request: NextRequest) {
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
    const parsed = UpdateSettingsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const reportingService = new ReportingService(supabase);
    const settings = await reportingService.updateReportSettings(user.id, parsed.data);

    return NextResponse.json({ data: settings });
  } catch (error) {
    console.error('[PUT /api/reports/settings] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

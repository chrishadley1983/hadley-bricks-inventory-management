import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSheetsClient } from '@/lib/google';

/**
 * GET /api/admin/sheets/test-connection
 * Tests the connection to Google Sheets using configured credentials
 */
export async function GET() {
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

    const sheetsClient = getSheetsClient();
    const result = await sheetsClient.testConnection();

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: result.message,
        spreadsheetTitle: result.spreadsheetTitle,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          message: result.message,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[GET /api/admin/sheets/test-connection] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
